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
  type ChatMessagePayload,
  type ChatHistoryPayload,
  type QaFloorPayload,
  type QaListPayload,
  type QaQuestion,
  type QaStatus,
} from '@lms/shared';
import { useAuthStore } from '@/lib/store/auth-store';
import { LIVE_SOCKET_TRANSPORTS, resolveLiveSocketUrl } from './url';


type LiveSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

export type ConnectionStatus =
  | 'idle'
  | 'connecting'
  | 'connected'
  | 'disconnected';

export interface LiveParticipant {
  participantId: string;
  name: string;
}

export type LiveResponses = Record<string, ResponseUpdatedPayload>;

export interface UseSessionSocketOptions {
  token?: string | null;
  debounceMs?: number;
  onSessionEnded?: (payload: SessionEndedPayload) => void;
}

export interface UseSessionSocketResult {
  status: ConnectionStatus;
  connected: boolean;
  focusedBlockId: string | null;
  sendFocus: (blockId: string) => void;
  saveResponse: (blockId: string, answerText: string) => void;
  /** Flush a response immediately (Submit button). */
  saveResponseNow: (blockId: string, answerText: string) => void;
  participants: LiveParticipant[];
  responses: LiveResponses;
  chatMessages: ChatMessagePayload[];
  sendChat: (text: string) => void;
  ended: boolean;
  /** Q&A queue (live from the server). */
  questions: QaQuestion[];
  askQuestion: (text: string) => void;
  voteQuestion: (questionId: string) => void;
  setQuestionStatus: (questionId: string, status: QaStatus) => void;
  /** Set when the host gives me the floor for one of my questions. */
  floor: (QaFloorPayload & { at: number }) | null;
  clearFloor: () => void;
}

function responseKey(participantId: string, blockId: string): string {
  return `${participantId}:${blockId}`;
}

export function useSessionSocket(
  sessionId: string | undefined,
  options: UseSessionSocketOptions = {},
): UseSessionSocketResult {
  const { token, debounceMs = 200, onSessionEnded } = options;

  const [status, setStatus] = useState<ConnectionStatus>('idle');
  const [focusedBlockId, setFocusedBlockId] = useState<string | null>(null);
  const [participants, setParticipants] = useState<LiveParticipant[]>([]);
  const [responses, setResponses] = useState<LiveResponses>({});
  const [chatMessages, setChatMessages] = useState<ChatMessagePayload[]>([]);
  const [ended, setEnded] = useState(false);
  const [questions, setQuestions] = useState<QaQuestion[]>([]);
  const [floor, setFloor] = useState<UseSessionSocketResult['floor']>(null);

  const socketRef = useRef<LiveSocket | null>(null);
  const sessionIdRef = useRef(sessionId);
  sessionIdRef.current = sessionId;
  const debounceTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(
    new Map(),
  );
  const onSessionEndedRef = useRef(onSessionEnded);
  onSessionEndedRef.current = onSessionEnded;
  const joinRetries = useRef(0);

  useEffect(() => {
    if (!sessionId) return;

    let authToken = token ?? null;
    if (authToken === null) {
      try {
        const raw = localStorage.getItem('lms-auth');
        if (raw) {
          const parsed = JSON.parse(raw) as {
            state?: {
              participantToken?: string | null;
              accessToken?: string | null;
            };
          };
          authToken =
            parsed.state?.participantToken ??
            parsed.state?.accessToken ??
            null;
        }
      } catch {
        authToken = null;
      }
    }

    if (!authToken) {
      setStatus('disconnected');
      return;
    }

    setStatus('connecting');
    setEnded(false);
    setChatMessages([]);
    setQuestions([]);
    joinRetries.current = 0;

    const url = resolveLiveSocketUrl();
    const socket: LiveSocket = io(url, {
      transports: LIVE_SOCKET_TRANSPORTS,
      auth: { token: authToken },
      query: { token: authToken },
      autoConnect: true,
      reconnection: true,
      reconnectionAttempts: 20,
      reconnectionDelay: 800,
      timeout: 12_000,
    });
    socketRef.current = socket;

    const join = () => {
      const sid = sessionIdRef.current;
      if (!sid || !socket.connected) return;
      socket.emit(WS_EVENTS.sessionJoin, { sessionId: sid });
    };

    socket.on('connect', () => {
      setStatus('connected');
      join();
      // One delayed re-join covers any mid-connect race on the server.
      window.setTimeout(join, 500);
    });

    socket.on('connect_error', (err) => {
      console.warn('[live] connect_error', err.message);
      setStatus('disconnected');
    });

    socket.on('disconnect', () => {
      setStatus('disconnected');
    });

    socket.io.on('reconnect', () => {
      joinRetries.current = 0;
      join();
    });

    socket.on(WS_EVENTS.focusChanged, (payload: FocusChangedPayload) => {
      setFocusedBlockId(payload.blockId);
    });

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

    socket.on(WS_EVENTS.responseUpdated, (payload: ResponseUpdatedPayload) => {
      setResponses((prev) => ({
        ...prev,
        [responseKey(payload.participantId, payload.blockId)]: payload,
      }));
    });

    socket.on(WS_EVENTS.chatHistory, (payload: ChatHistoryPayload) => {
      if (payload.sessionId !== sessionId) return;
      setChatMessages(payload.messages);
    });

    socket.on(WS_EVENTS.chatMessage, (payload: ChatMessagePayload) => {
      if (payload.sessionId !== sessionId) return;
      setChatMessages((prev) => {
        if (prev.some((m) => m.id === payload.id)) return prev;
        return [...prev, payload];
      });
    });

    socket.on(WS_EVENTS.qaList, (payload: QaListPayload) => {
      if (payload.sessionId !== sessionId) return;
      setQuestions(payload.questions);
    });

    socket.on(WS_EVENTS.qaFloor, (payload: QaFloorPayload) => {
      if (payload.sessionId !== sessionId) return;
      setFloor({ ...payload, at: Date.now() });
    });

    socket.on(WS_EVENTS.sessionEnded, (payload: SessionEndedPayload) => {
      setEnded(true);
      onSessionEndedRef.current?.(payload);
    });

    const timers = debounceTimers.current;
    return () => {
      for (const timer of timers.values()) clearTimeout(timer);
      timers.clear();
      socket.removeAllListeners();
      socket.disconnect();
      socketRef.current = null;
      setStatus('idle');
    };
    // Only reconnect when the session changes — not on every 15m token rotate.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId]);

  // Keep socket auth fresh without tearing down the connection.
  useEffect(() => {
    if (!token || !socketRef.current) return;
    const sock = socketRef.current;
    sock.auth = { token };
    if (sock.io?.opts) {
      sock.io.opts.query = { token };
    }
  }, [token]);

  const sendFocus = useCallback(
    (blockId: string) => {
      if (!sessionId) return;
      setFocusedBlockId(blockId);
      socketRef.current?.emit(WS_EVENTS.focusSet, { sessionId, blockId });
      // REST backup — persists + broadcasts even if WS focus:set fails.
      const auth =
        token ??
        useAuthStore.getState().accessToken ??
        useAuthStore.getState().participantToken;
      void fetch(
        `${process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001'}/sessions/${sessionId}/focus`,
        {
          method: 'POST',
          credentials: 'include',
          headers: {
            'Content-Type': 'application/json',
            ...(auth ? { Authorization: `Bearer ${auth}` } : {}),
          },
          body: JSON.stringify({ blockId }),
        },
      ).catch(() => undefined);
    },
    [sessionId, token],
  );

  const emitSave = useCallback(
    (blockId: string, answerText: string) => {
      if (!sessionId) return;
      socketRef.current?.emit(WS_EVENTS.responseSave, {
        sessionId,
        blockId,
        answerText,
      });
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
        emitSave(blockId, answerText);
        timers.delete(blockId);
      }, debounceMs);
      timers.set(blockId, t);
    },
    [sessionId, debounceMs, emitSave],
  );

  const saveResponseNow = useCallback(
    (blockId: string, answerText: string) => {
      if (!sessionId) return;
      const timers = debounceTimers.current;
      const existing = timers.get(blockId);
      if (existing) {
        clearTimeout(existing);
        timers.delete(blockId);
      }
      emitSave(blockId, answerText);
    },
    [sessionId, emitSave],
  );

  const sendChat = useCallback(
    (text: string) => {
      if (!sessionId) return;
      const trimmed = text.trim();
      if (!trimmed) return;
      // Ensure we are joined before chatting.
      socketRef.current?.emit(WS_EVENTS.sessionJoin, { sessionId });
      socketRef.current?.emit(WS_EVENTS.chatSend, {
        sessionId,
        text: trimmed,
      });
    },
    [sessionId],
  );

  const askQuestion = useCallback(
    (text: string) => {
      const trimmed = text.trim();
      if (!sessionId || !trimmed) return;
      socketRef.current?.emit(WS_EVENTS.qaAsk, { sessionId, text: trimmed });
    },
    [sessionId],
  );

  const voteQuestion = useCallback(
    (questionId: string) => {
      if (!sessionId) return;
      socketRef.current?.emit(WS_EVENTS.qaVote, { sessionId, questionId });
    },
    [sessionId],
  );

  const setQuestionStatus = useCallback(
    (questionId: string, next: QaStatus) => {
      if (!sessionId) return;
      socketRef.current?.emit(WS_EVENTS.qaStatus, {
        sessionId,
        questionId,
        status: next,
      });
    },
    [sessionId],
  );

  const clearFloor = useCallback(() => setFloor(null), []);

  return {
    status,
    connected: status === 'connected',
    focusedBlockId,
    sendFocus,
    saveResponse,
    saveResponseNow,
    participants,
    responses,
    chatMessages,
    sendChat,
    ended,
    questions,
    askQuestion,
    voteQuestion,
    setQuestionStatus,
    floor,
    clearFloor,
  };
}
