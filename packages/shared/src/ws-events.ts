/**
 * WebSocket contract — the single source of truth for the Socket.IO `/live`
 * namespace. Both the Nest gateway (`apps/api`) and the web client import these
 * event names, payload types, and the typed event maps from here.
 *
 * Room convention: `session:{sessionId}`.
 */

/** Socket.IO namespace for live sessions. */
export const WS_NAMESPACE = '/live' as const;

/** Canonical event names. Use these constants, never string literals. */
export const WS_EVENTS = {
  /** client → server: join the room for a session */
  sessionJoin: 'session:join',
  /** teacher → server: focus a specific block */
  focusSet: 'focus:set',
  /** server → all in room: focused block changed (null = none) */
  focusChanged: 'focus:changed',
  /** student → server: save/update an answer */
  responseSave: 'response:save',
  /** server → teacher: a participant's answer was updated */
  responseUpdated: 'response:updated',
  /** server → teacher: a participant joined */
  participantJoined: 'participant:joined',
  /** server → all in room: the session was ended */
  sessionEnded: 'session:ended',
} as const;

export type WsEventName = (typeof WS_EVENTS)[keyof typeof WS_EVENTS];

// ── Payloads ───────────────────────────────────────────────────────────────

/** `session:join` (client → server). */
export interface SessionJoinPayload {
  sessionId: string;
}

/** `focus:set` (teacher → server). */
export interface FocusSetPayload {
  sessionId: string;
  blockId: string;
}

/** `focus:changed` (server → all). `null` means nothing is focused. */
export interface FocusChangedPayload {
  blockId: string | null;
}

/** `response:save` (student → server). */
export interface ResponseSavePayload {
  sessionId: string;
  blockId: string;
  answerText: string;
}

/** `response:updated` (server → teacher). `at` is an ISO timestamp string. */
export interface ResponseUpdatedPayload {
  participantId: string;
  blockId: string;
  answerText: string;
  at: string;
}

/** `participant:joined` (server → teacher). */
export interface ParticipantJoinedPayload {
  participantId: string;
  name: string;
}

/** `session:ended` (server → all). */
export interface SessionEndedPayload {
  sessionId: string;
}

// ── Typed event maps for socket.io ───────────────────────────────────────────

/** Events emitted by the server and listened to by clients. */
export interface ServerToClientEvents {
  [WS_EVENTS.focusChanged]: (payload: FocusChangedPayload) => void;
  [WS_EVENTS.responseUpdated]: (payload: ResponseUpdatedPayload) => void;
  [WS_EVENTS.participantJoined]: (payload: ParticipantJoinedPayload) => void;
  [WS_EVENTS.sessionEnded]: (payload: SessionEndedPayload) => void;
}

/** Events emitted by clients and handled by the server. */
export interface ClientToServerEvents {
  [WS_EVENTS.sessionJoin]: (payload: SessionJoinPayload) => void;
  [WS_EVENTS.focusSet]: (payload: FocusSetPayload) => void;
  [WS_EVENTS.responseSave]: (payload: ResponseSavePayload) => void;
}
