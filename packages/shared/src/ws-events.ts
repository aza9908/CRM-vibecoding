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
  /** client → server: send a group-chat message */
  chatSend: 'chat:send',
  /** server → all in room: new chat message */
  chatMessage: 'chat:message',
  /** server → joiner: recent chat history after session:join */
  chatHistory: 'chat:history',

  // ── Video room (WebRTC mesh, signaling relayed over this namespace) ──────
  /** client → server: enter the session's video room (ack: RtcJoinAck) */
  rtcJoin: 'rtc:join',
  /** client → server: leave the video room */
  rtcLeave: 'rtc:leave',
  /** client → server: my mic/camera/screen/hand state changed */
  rtcState: 'rtc:state',
  /** client ↔ server: SDP / ICE relay to one peer */
  rtcSignal: 'rtc:signal',
  /** host → server → target: mute / lower hand / stop video */
  rtcModerate: 'rtc:moderate',
  /** server → room: a peer entered the video room */
  rtcPeerJoined: 'rtc:peer-joined',
  /** server → room: a peer left the video room */
  rtcPeerLeft: 'rtc:peer-left',
  /** server → room: a peer's media state changed */
  rtcPeerState: 'rtc:peer-state',
  /** server → whole session (and each joiner): is a video call running? */
  rtcRoomState: 'rtc:room-state',

  // ── Q&A queue ────────────────────────────────────────────────────────────
  /** client → server: ask a question */
  qaAsk: 'qa:ask',
  /** client → server: upvote a question (once per person) */
  qaVote: 'qa:vote',
  /** host → server: set a question's status (live = has the floor) */
  qaStatus: 'qa:status',
  /** server → room: full question list (after any change / on join) */
  qaList: 'qa:list',
  /** server → the asker: the host gave you the floor */
  qaFloor: 'qa:floor',
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
  /** Explicit mark-complete override — see `saveSessionResponseSchema`. */
  completed?: boolean;
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

/** `chat:send` (client → server). */
export interface ChatSendPayload {
  sessionId: string;
  text: string;
}

/** A single group-chat message (server → clients). */
export interface ChatMessagePayload {
  id: string;
  sessionId: string;
  senderId: string;
  senderName: string;
  /** `teacher` | `participant` */
  role: 'teacher' | 'participant';
  text: string;
  at: string;
}

/** `chat:history` (server → joiner). */
export interface ChatHistoryPayload {
  sessionId: string;
  messages: ChatMessagePayload[];
}

// ── Video room payloads ─────────────────────────────────────────────────────

/** What a peer is currently publishing. Stream ids let receivers tell the
 * camera stream from the screen-share stream (msid survives the relay). */
export interface RtcMediaState {
  audio: boolean;
  video: boolean;
  screen: boolean;
  hand: boolean;
  cameraStreamId: string | null;
  screenStreamId: string | null;
}

/** A member of the video room. `peerId` is the server-side socket id. */
export interface RtcPeer {
  peerId: string;
  name: string;
  /** `host` = teacher / methodist / admin; can moderate. */
  role: 'host' | 'participant';
  media: RtcMediaState;
}

/** RTCIceServer as JSON (kept local so shared stays DOM-lib free). */
export interface RtcIceServer {
  urls: string | string[];
  username?: string;
  credential?: string;
}

/** `rtc:join` (client → server). */
export interface RtcJoinPayload {
  sessionId: string;
  media: RtcMediaState;
}

/** Ack of `rtc:join`. */
export interface RtcJoinAck {
  ok: boolean;
  error?: string;
  selfId?: string;
  role?: RtcPeer['role'];
  peers?: RtcPeer[];
  iceServers?: RtcIceServer[];
}

/** `rtc:leave` (client → server). */
export interface RtcLeavePayload {
  sessionId: string;
}

/** `rtc:state` (client → server). */
export interface RtcStatePayload {
  sessionId: string;
  media: RtcMediaState;
}

/** SDP description as JSON (RTCSessionDescriptionInit). */
export interface RtcDescription {
  type: 'offer' | 'answer' | 'pranswer' | 'rollback';
  sdp?: string;
}

/** ICE candidate as JSON (RTCIceCandidateInit). */
export interface RtcCandidate {
  candidate?: string;
  sdpMid?: string | null;
  sdpMLineIndex?: number | null;
  usernameFragment?: string | null;
}

/** `rtc:signal` client → server: `to` is the target peerId. */
export interface RtcSignalPayload {
  sessionId: string;
  to: string;
  description?: RtcDescription;
  candidate?: RtcCandidate | null;
}

/** `rtc:signal` server → client: `from` is the sender peerId. */
export interface RtcSignalRelay {
  from: string;
  description?: RtcDescription;
  candidate?: RtcCandidate | null;
}

export type RtcModerateAction = 'mute' | 'stop-video' | 'lower-hand';

/** `rtc:moderate` host → server. `target: '*'` = everyone except the host. */
export interface RtcModeratePayload {
  sessionId: string;
  target: string;
  action: RtcModerateAction;
}

/** `rtc:moderate` server → target. */
export interface RtcModerateRelay {
  action: RtcModerateAction;
}

/** `rtc:room-state` (server → session). A call is "active" while the host
 * (teacher) is in it; students auto-join active calls. `startedAt` changes
 * each time the host starts a new call. */
export interface RtcRoomStatePayload {
  sessionId: string;
  active: boolean;
  count: number;
  startedAt: string | null;
}

/** `rtc:peer-left` (server → room). */
export interface RtcPeerLeftPayload {
  peerId: string;
}

/** `rtc:peer-state` (server → room). */
export interface RtcPeerStatePayload {
  peerId: string;
  media: RtcMediaState;
}

// ── Q&A payloads ─────────────────────────────────────────────────────────────

export type QaStatus = 'open' | 'live' | 'answered';

export interface QaQuestion {
  id: string;
  sessionId: string;
  authorId: string;
  authorName: string;
  text: string;
  votes: number;
  /** Ids of everyone who upvoted — lets each client show its own vote. */
  voterIds: string[];
  status: QaStatus;
  at: string;
}

/** `qa:ask` (client → server). */
export interface QaAskPayload {
  sessionId: string;
  text: string;
}

/** `qa:vote` (client → server). */
export interface QaVotePayload {
  sessionId: string;
  questionId: string;
}

/** `qa:status` (host → server). */
export interface QaStatusPayload {
  sessionId: string;
  questionId: string;
  status: QaStatus;
}

/** `qa:list` (server → room). */
export interface QaListPayload {
  sessionId: string;
  questions: QaQuestion[];
}

/** `qa:floor` (server → asker). */
export interface QaFloorPayload {
  sessionId: string;
  questionId: string;
  text: string;
}

// ── Typed event maps for socket.io ───────────────────────────────────────────

/** Events emitted by the server and listened to by clients. */
export interface ServerToClientEvents {
  [WS_EVENTS.focusChanged]: (payload: FocusChangedPayload) => void;
  [WS_EVENTS.responseUpdated]: (payload: ResponseUpdatedPayload) => void;
  [WS_EVENTS.participantJoined]: (payload: ParticipantJoinedPayload) => void;
  [WS_EVENTS.sessionEnded]: (payload: SessionEndedPayload) => void;
  [WS_EVENTS.chatMessage]: (payload: ChatMessagePayload) => void;
  [WS_EVENTS.chatHistory]: (payload: ChatHistoryPayload) => void;
  [WS_EVENTS.rtcPeerJoined]: (payload: RtcPeer) => void;
  [WS_EVENTS.rtcPeerLeft]: (payload: RtcPeerLeftPayload) => void;
  [WS_EVENTS.rtcPeerState]: (payload: RtcPeerStatePayload) => void;
  [WS_EVENTS.rtcSignal]: (payload: RtcSignalRelay) => void;
  [WS_EVENTS.rtcModerate]: (payload: RtcModerateRelay) => void;
  [WS_EVENTS.rtcRoomState]: (payload: RtcRoomStatePayload) => void;
  [WS_EVENTS.qaList]: (payload: QaListPayload) => void;
  [WS_EVENTS.qaFloor]: (payload: QaFloorPayload) => void;
}

/** Events emitted by clients and handled by the server. */
export interface ClientToServerEvents {
  [WS_EVENTS.sessionJoin]: (payload: SessionJoinPayload) => void;
  [WS_EVENTS.focusSet]: (payload: FocusSetPayload) => void;
  [WS_EVENTS.responseSave]: (payload: ResponseSavePayload) => void;
  [WS_EVENTS.chatSend]: (payload: ChatSendPayload) => void;
  [WS_EVENTS.rtcJoin]: (
    payload: RtcJoinPayload,
    ack?: (res: RtcJoinAck) => void,
  ) => void;
  [WS_EVENTS.rtcLeave]: (payload: RtcLeavePayload) => void;
  [WS_EVENTS.rtcState]: (payload: RtcStatePayload) => void;
  [WS_EVENTS.rtcSignal]: (payload: RtcSignalPayload) => void;
  [WS_EVENTS.rtcModerate]: (payload: RtcModeratePayload) => void;
  [WS_EVENTS.qaAsk]: (payload: QaAskPayload) => void;
  [WS_EVENTS.qaVote]: (payload: QaVotePayload) => void;
  [WS_EVENTS.qaStatus]: (payload: QaStatusPayload) => void;
}
