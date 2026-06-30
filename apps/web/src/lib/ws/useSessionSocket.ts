'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { io, type Socket } from 'socket.io-client';
import {
  WS_EVENTS,
  type ServerToClientEvents,
  type ClientToServerEvents,
  type FocusChangedPayload,
  type ResponseUpdatedPayload,
  type ParticipantJoinedPayload,
  type SessionEndedPayload,
} from '@lms/shared';

const WS_URL = process.env.NEXT_PUBLIC_WS_URL ?? 'ws://localhost:3001/live';

type LiveSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

export type ConnectionStatus =
  | 'idle'
  | 'connecting'
  | 'connected'
  | 'disconnected';

/** A live participant as seen by the teacher (accumulated from participant:joined). */
export interface LiveParticipant {
  participantId: string;
  name: string;
}

/** Latest answer per (participantId, blockId), keyed for quick teacher rendering. */
export type LiveResponses = Record<string, ResponseUpdatedPayload>;

export interface UseSessionSocketOptions {
  /** Override the handshake token. Falls back to participant/user token. */
  token?: string | null;
  /** Debounce window for outgoing responses (ms). Default 300. */
  debounceMs?: number;
  /** Called once when the server signals the session ended. */
  onSessionEnded?: (payload: SessionEndedPayload) => void;
}

export interface UseSessionSocketResult {
  status: ConnectionStatus;
  connected: boolean;
  /** Block the teacher is currently focusing (null = none). */
  focusedBlockId: string | null;
  /** Teacher: switch the focused block. */
  sendFocus: (blockId: string) => void;
  /** Student: save an answer for a block (debounced). */
  saveResponse: (blockId: string, answerText: string) => void;
  /** Teacher: participants that have joined this session. */
  participants: LiveParticipant[];
  /** Teacher: latest response per participant+block. */
  responses: LiveResponses;
  /** Whether the session has ended. */
  ended: boolean;
}

function responseKey(participantId: string, blockId: string): string {
  return `${participantId}:${blockId}`;
}

/**
 * Connects to the /live Socket.IO namespace, joins room session:{id}, and
 * wires the focus/response/participant/ended contract from @lms/shared.
 *
 * - `token` goes into `handshake.auth.token` (user OR participant JWT).
 * - Emits `session:join` on connect; server replies with current focus.
 * - `saveResponse` is debounced (default 300ms) so keystrokes don't flood WS.
 * - Responses are broadcast only to the teacher by the server; students never
 *   receive others' answers.
 */
export function useSessionSocket(
  sessionId: string | undefined,
  options: UseSessionSocketOptions = {},
): UseSessionSocketResult {
  const { token, debounceMs = 300, onSessionEnded } = options;

  const [status, setStatus] = useState<ConnectionStatus>('idle');
  const [focusedBlockId, setFocusedBlockId] = useState<string | null>(null);
  const [participants, setParticipants] = useState<LiveParticipant[]>([]);
  const [responses, setResponses] = useState<LiveResponses>({});
  const [ended, setEnded] = useState(false);

  const socketRef = useRef<LiveSocket | null>(null);
  const debounceTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(
    new Map(),
  );
  const onSessionEndedRef = useRef(onSessionEnded);
  onSessionEndedRef.current = onSessionEnded;

  useEffect(() => {
    if (!sessionId) return;

    // Resolve the handshake token lazily to avoid SSR localStorage access.
    let authToken = token ?? null;
    if (authToken === null) {
      try {
        const raw = localStorage.getItem('lms-auth');
        if (raw) {
          const parsed = JSON.parse(raw) as {
            state?: { participantToken?: string | null; accessToken?: string | null };
          };
          authToken =
            parsed.state?.participantToken ?? parsed.state?.accessToken ?? null;
        }
      } catch {
        authToken = null;
      }
    }

    setStatus('connecting');
    setEnded(false);

    const socket: LiveSocket = io(WS_URL, {
      transports: ['websocket'],
      auth: { token: authToken ?? '' },
      autoConnect: true,
      reconnection: true,
    });
    socketRef.current = socket;

    socket.on('connect', () => {
      setStatus('connected');
      socket.emit(WS_EVENTS.sessionJoin, { sessionId });
    });

    socket.on('disconnect', () => {
      setStatus('disconnected');
    });

    socket.io.on('reconnect', () => {
      socket.emit(WS_EVENTS.sessionJoin, { sessionId });
    });

    socket.on(
      WS_EVENTS.focusChanged,
      (payload: FocusChangedPayload) => {
        setFocusedBlockId(payload.blockId);
      },
    );

    socket.on(
      WS_EVENTS.participantJoined,
      (payload: ParticipantJoinedPayload) => {
        setParticipants((prev) => {
          if (prev.some((p) => p.participantId === payload.participantId)) {
            return prev;
          }
          return [
            ...prev,
            { participantId: payload.participantId, name: payload.name },
          ];
        });
      },
    );

    socket.on(
      WS_EVENTS.responseUpdated,
      (payload: ResponseUpdatedPayload) => {
        setResponses((prev) => ({
          ...prev,
          [responseKey(payload.participantId, payload.blockId)]: payload,
        }));
      },
    );

    socket.on(
      WS_EVENTS.sessionEnded,
      (payload: SessionEndedPayload) => {
        setEnded(true);
        onSessionEndedRef.current?.(payload);
      },
    );

    const timers = debounceTimers.current;
    return () => {
      for (const timer of timers.values()) clearTimeout(timer);
      timers.clear();
      socket.removeAllListeners();
      socket.disconnect();
      socketRef.current = null;
      setStatus('idle');
    };
    // Reconnect when sessionId/token changes; debounceMs is read fresh below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId, token]);

  const sendFocus = useCallback(
    (blockId: string) => {
      if (!sessionId) return;
      socketRef.current?.emit(WS_EVENTS.focusSet, { sessionId, blockId });
      // Optimistic: reflect locally for the teacher immediately.
      setFocusedBlockId(blockId);
    },
    [sessionId],
  );

  const saveResponse = useCallback(
    (blockId: string, answerText: string) => {
      if (!sessionId) return;
      const timers = debounceTimers.current;
      const existing = timers.get(blockId);
      if (existing) clearTimeout(existing);
      const t = setTimeout(() => {
        socketRef.current?.emit(WS_EVENTS.responseSave, {
          sessionId,
          blockId,
          answerText,
        });
        timers.delete(blockId);
      }, debounceMs);
      timers.set(blockId, t);
    },
    [sessionId, debounceMs],
  );

  return {
    status,
    connected: status === 'connected',
    focusedBlockId,
    sendFocus,
    saveResponse,
    participants,
    responses,
    ended,
  };
}
