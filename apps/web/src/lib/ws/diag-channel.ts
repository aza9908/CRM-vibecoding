'use client';

import { useSyncExternalStore } from 'react';
import type {
  RtcAck,
  RtcDiagIssue,
  RtcDiagKind,
  RtcDiagListPayload,
  RtcDiagUpdatePayload,
} from '@lms/shared';

/**
 * «Помощник тренера» — participants' technical problems, for teachers only.
 *
 * Fed by the teacher's session socket (the server sends these events to the
 * teachers' room only). Kept outside React state, like the pulse channel, so
 * a burst of updates re-renders only the coach panel, not the lesson page.
 */
export interface DiagSnapshot {
  /** Open problems, oldest first. */
  issues: RtcDiagIssue[];
}

type Listener = () => void;
type NewIssueListener = (issue: RtcDiagIssue) => void;

const key = (peerId: string, kind: RtcDiagKind) => `${peerId}:${kind}`;

export class DiagChannel {
  private snapshot: DiagSnapshot = { issues: [] };
  private readonly listeners = new Set<Listener>();
  private readonly newListeners = new Set<NewIssueListener>();
  /** Wired by the session hook to the live socket. */
  send: { hint: (peerId: string, kind: RtcDiagKind) => Promise<RtcAck> } = {
    hint: async () => ({ ok: false, error: 'offline' }),
  };

  subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): DiagSnapshot => this.snapshot;

  private set(issues: RtcDiagIssue[]): void {
    issues.sort((a, b) => a.since.localeCompare(b.since));
    this.snapshot = { issues };
    for (const l of this.listeners) l();
  }

  // ── fed by the socket ────────────────────────────────────────────────────

  pushList(payload: RtcDiagListPayload): void {
    const before = new Set(this.snapshot.issues.map((i) => key(i.peerId, i.kind)));
    const issues = payload.issues.slice(0, 500);
    this.set(issues);
    for (const issue of issues) {
      if (!before.has(key(issue.peerId, issue.kind))) this.emitNew(issue);
    }
  }

  pushUpdate(update: RtcDiagUpdatePayload): void {
    const k = key(update.peerId, update.kind);
    const rest = this.snapshot.issues.filter((i) => key(i.peerId, i.kind) !== k);
    if (update.resolved) {
      if (rest.length !== this.snapshot.issues.length) this.set(rest);
      return;
    }
    const isNew = rest.length === this.snapshot.issues.length;
    const issue: RtcDiagIssue = {
      peerId: update.peerId,
      name: update.name,
      kind: update.kind,
      since: update.since,
      ...(update.detail ? { detail: update.detail } : {}),
    };
    this.set([...rest, issue]);
    if (isNew) this.emitNew(issue);
  }

  reset(): void {
    this.set([]);
  }

  private emitNew(issue: RtcDiagIssue): void {
    for (const l of this.newListeners) l(issue);
  }

  // ── used by components ───────────────────────────────────────────────────

  /** A problem appeared that was not open before (for a teacher toast). */
  onNewIssue(listener: NewIssueListener): () => void {
    this.newListeners.add(listener);
    return () => this.newListeners.delete(listener);
  }

  hint(peerId: string, kind: RtcDiagKind): Promise<RtcAck> {
    return this.send.hint(peerId, kind);
  }
}

export function useDiag(channel: DiagChannel): DiagSnapshot {
  return useSyncExternalStore(channel.subscribe, channel.getSnapshot, channel.getSnapshot);
}
