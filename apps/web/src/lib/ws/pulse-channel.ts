'use client';

import { useSyncExternalStore } from 'react';
import type {
  PulseAck,
  PulseDetailPayload,
  PulseStatePayload,
  PulseValue,
} from '@lms/shared';

/**
 * «Пульс класса» state, kept OUTSIDE React state on purpose.
 *
 * During a check the aggregate changes with every answer (×50 people) and
 * every answer also fires an emoji. If that lived in the session hook's state
 * the whole lesson page would re-render each time; instead the hook owns one
 * stable `PulseChannel` and only the pulse components subscribe to it.
 */
export interface PulseSnapshot {
  /** Current or last check (public aggregate). */
  state: PulseStatePayload | null;
  /** Teachers only: who answered what, who is silent. */
  detail: PulseDetailPayload | null;
  /** My own answer to `state.id`. */
  mine: PulseValue | null;
}

type Listener = () => void;
type ReactionListener = (value: PulseValue) => void;

export class PulseChannel {
  private snapshot: PulseSnapshot = { state: null, detail: null, mine: null };
  private readonly listeners = new Set<Listener>();
  private readonly reactionListeners = new Set<ReactionListener>();
  /** Wired by the session hook to the live socket. */
  send: {
    start: (question: string) => Promise<PulseAck>;
    answer: (value: PulseValue) => Promise<PulseAck>;
    close: () => Promise<PulseAck>;
  } = {
    start: async () => ({ ok: false, error: 'offline' }),
    answer: async () => ({ ok: false, error: 'offline' }),
    close: async () => ({ ok: false, error: 'offline' }),
  };

  subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): PulseSnapshot => this.snapshot;

  private set(next: PulseSnapshot): void {
    this.snapshot = next;
    for (const l of this.listeners) l();
  }

  // ── fed by the socket ────────────────────────────────────────────────────

  pushState(state: PulseStatePayload): void {
    const sameCheck = this.snapshot.state?.id === state.id;
    this.set({
      state,
      detail: sameCheck ? this.snapshot.detail : null,
      mine: sameCheck ? this.snapshot.mine : null,
    });
  }

  pushDetail(detail: PulseDetailPayload): void {
    this.set({ ...this.snapshot, detail });
  }

  pushReaction(value: PulseValue): void {
    for (const l of this.reactionListeners) l(value);
  }

  reset(): void {
    this.set({ state: null, detail: null, mine: null });
  }

  // ── used by components ───────────────────────────────────────────────────

  /** Every answer in the room, for the emoji rain. */
  onReaction(listener: ReactionListener): () => void {
    this.reactionListeners.add(listener);
    return () => this.reactionListeners.delete(listener);
  }

  start(question = ''): Promise<PulseAck> {
    return this.send.start(question);
  }

  /** Optimistic: my choice shows at once and is rolled back if refused. */
  async answer(value: PulseValue): Promise<PulseAck> {
    const before = this.snapshot.mine;
    const checkId = this.snapshot.state?.id;
    this.set({ ...this.snapshot, mine: value });
    const res = await this.send.answer(value);
    if (!res.ok && res.error !== 'too_fast' && this.snapshot.state?.id === checkId) {
      this.set({ ...this.snapshot, mine: before });
    }
    return res;
  }

  close(): Promise<PulseAck> {
    return this.send.close();
  }
}

export function usePulse(channel: PulseChannel): PulseSnapshot {
  return useSyncExternalStore(channel.subscribe, channel.getSnapshot, channel.getSnapshot);
}
