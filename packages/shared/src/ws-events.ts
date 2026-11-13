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

  // ── Video room (WebRTC through the server-side SFU; signaling here) ─────
  /** client → server: enter the session's video room (ack: RtcJoinAck) */
  rtcJoin: 'rtc:join',
  /** client → server: leave the video room */
  rtcLeave: 'rtc:leave',
  /** client → server: my mic/camera/screen/hand state changed */
  rtcState: 'rtc:state',
  /** host → server → target: mute / lower hand / stop video */
  rtcModerate: 'rtc:moderate',
  /** host → server: end the call for everyone */
  rtcCallEnd: 'rtc:call-end',
  /** host → server: I started / stopped recording the call */
  rtcRecording: 'rtc:recording',
  /** client → server: create a send / receive transport (ack) */
  rtcTransportCreate: 'rtc:transport-create',
  /** client → server: DTLS connect a transport (ack) */
  rtcTransportConnect: 'rtc:transport-connect',
  /** client → server: restart ICE after a network change (ack) */
  rtcTransportRestartIce: 'rtc:transport-restart-ice',
  /** client → server: start publishing a track (ack) */
  rtcProduce: 'rtc:produce',
  /** client → server: stop publishing a track */
  rtcProducerClose: 'rtc:producer-close',
  /** client → server: pause / resume my track (mute) */
  rtcProducerPause: 'rtc:producer-pause',
  /** client → server: receive someone's track (ack) */
  rtcConsume: 'rtc:consume',
  /** client → server: pause / resume a received track */
  rtcConsumerPause: 'rtc:consumer-pause',
  /** client → server: quality wanted for a received video (stage vs tile) */
  rtcConsumerLayers: 'rtc:consumer-layers',
  /** server → room: a peer entered the video room */
  rtcPeerJoined: 'rtc:peer-joined',
  /** server → room: a peer left the video room */
  rtcPeerLeft: 'rtc:peer-left',
  /** server → room: a peer's media state changed */
  rtcPeerState: 'rtc:peer-state',
  /** server → room: a peer started publishing a track */
  rtcProducerNew: 'rtc:producer-new',
  /** server → room: a published track went away */
  rtcProducerClosed: 'rtc:producer-closed',
  /** server → room: who is speaking right now */
  rtcSpeakers: 'rtc:speakers',
  /** server → room: the host ended the call (or the session ended) */
  rtcCallEnded: 'rtc:call-ended',
  /** server → room: media server restarted — re-join to restore media */
  rtcReset: 'rtc:reset',
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

/** What a peer is currently publishing (plus the raised hand). The stream
 * id fields are legacy and unused by the SFU client. */
export interface RtcMediaState {
  audio: boolean;
  video: boolean;
  screen: boolean;
  hand: boolean;
  cameraStreamId: string | null;
  screenStreamId: string | null;
}

/** A member of the video room. `peerId` is stable across reconnects. */
export interface RtcPeer {
  peerId: string;
  name: string;
  /** `host` = teacher / methodist / admin; can moderate. */
  role: 'host' | 'participant';
  media: RtcMediaState;
}

/** What a published track carries. */
export type RtcSource = 'mic' | 'camera' | 'screen' | 'screen-audio';

/** A track someone publishes into the room. */
export interface RtcProducerInfo {
  producerId: string;
  peerId: string;
  kind: 'audio' | 'video';
  source: RtcSource;
  paused: boolean;
}

/** `rtc:join` (client → server). */
export interface RtcJoinPayload {
  sessionId: string;
  media: RtcMediaState;
  /** Random per-tab id (kept across reloads/reconnects) so a returning
   * client replaces its old entry instead of appearing twice. */
  clientId: string;
}

/** Ack of `rtc:join`. Media-server objects are opaque JSON here so `shared`
 * stays free of mediasoup types. */
export interface RtcJoinAck {
  ok: boolean;
  error?: string;
  selfId?: string;
  role?: RtcPeer['role'];
  peers?: RtcPeer[];
  producers?: RtcProducerInfo[];
  routerRtpCapabilities?: unknown;
  /** Identifies the running call (changes when a new call starts). */
  startedAt?: string | null;
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

export interface RtcAck {
  ok: boolean;
  error?: string;
}

/** `rtc:transport-create`. */
export interface RtcTransportCreatePayload {
  direction: 'send' | 'recv';
}
export interface RtcTransportCreateAck extends RtcAck {
  /** { id, iceParameters, iceCandidates, dtlsParameters } */
  params?: unknown;
}

/** `rtc:transport-connect`. */
export interface RtcTransportConnectPayload {
  transportId: string;
  dtlsParameters: unknown;
}

/** `rtc:transport-restart-ice`. */
export interface RtcTransportRestartIcePayload {
  transportId: string;
}
export interface RtcTransportRestartIceAck extends RtcAck {
  iceParameters?: unknown;
}

/** `rtc:produce`. */
export interface RtcProducePayload {
  transportId: string;
  kind: 'audio' | 'video';
  rtpParameters: unknown;
  source: RtcSource;
}
export interface RtcProduceAck extends RtcAck {
  producerId?: string;
}

/** `rtc:producer-close`. */
export interface RtcProducerClosePayload {
  producerId: string;
}

/** `rtc:producer-pause`. */
export interface RtcProducerPausePayload {
  producerId: string;
  paused: boolean;
}

/** `rtc:consume`. */
export interface RtcConsumePayload {
  producerId: string;
  rtpCapabilities: unknown;
}
export interface RtcConsumeAck extends RtcAck {
  /** { id, producerId, kind, rtpParameters } */
  params?: unknown;
}

/** `rtc:consumer-pause`. */
export interface RtcConsumerPausePayload {
  consumerId: string;
  paused: boolean;
}

/** `rtc:consumer-layers` — 0 = thumbnail, 2 = best. */
export interface RtcConsumerLayersPayload {
  consumerId: string;
  spatialLayer: number;
}

/** `rtc:producer-closed` (server → room). */
export interface RtcProducerClosedPayload {
  producerId: string;
  peerId: string;
}

/** `rtc:speakers` (server → room). Loudest first; empty = silence. */
export interface RtcSpeakersPayload {
  speakers: { peerId: string; volume: number }[];
}

/** `rtc:call-end` (host → server) and `rtc:call-ended` (server → room). */
export interface RtcCallEndPayload {
  sessionId: string;
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

/** `rtc:room-state` (server → session). A call becomes active when a host
 * (teacher) enters it and stays active until the host ends it or the session
 * ends — a host's reload or network blip does NOT end it. Students auto-join
 * active calls. `startedAt` changes each time a new call starts. */
export interface RtcRoomStatePayload {
  sessionId: string;
  active: boolean;
  count: number;
  startedAt: string | null;
  /** A host is recording the call — everyone is shown a «REC» mark. */
  recording?: boolean;
}

/** `rtc:recording` (host → server). */
export interface RtcRecordingPayload {
  sessionId: string;
  on: boolean;
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
  [WS_EVENTS.rtcModerate]: (payload: RtcModerateRelay) => void;
  [WS_EVENTS.rtcRoomState]: (payload: RtcRoomStatePayload) => void;
  [WS_EVENTS.rtcProducerNew]: (payload: RtcProducerInfo) => void;
  [WS_EVENTS.rtcProducerClosed]: (payload: RtcProducerClosedPayload) => void;
  [WS_EVENTS.rtcSpeakers]: (payload: RtcSpeakersPayload) => void;
  [WS_EVENTS.rtcCallEnded]: (payload: RtcCallEndPayload) => void;
  [WS_EVENTS.rtcReset]: () => void;
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
  [WS_EVENTS.rtcCallEnd]: (payload: RtcCallEndPayload) => void;
  [WS_EVENTS.rtcRecording]: (payload: RtcRecordingPayload) => void;
  [WS_EVENTS.rtcTransportCreate]: (
    payload: RtcTransportCreatePayload,
    ack?: (res: RtcTransportCreateAck) => void,
  ) => void;
  [WS_EVENTS.rtcTransportConnect]: (
    payload: RtcTransportConnectPayload,
    ack?: (res: RtcAck) => void,
  ) => void;
  [WS_EVENTS.rtcTransportRestartIce]: (
    payload: RtcTransportRestartIcePayload,
    ack?: (res: RtcTransportRestartIceAck) => void,
  ) => void;
  [WS_EVENTS.rtcProduce]: (
    payload: RtcProducePayload,
    ack?: (res: RtcProduceAck) => void,
  ) => void;
  [WS_EVENTS.rtcProducerClose]: (payload: RtcProducerClosePayload) => void;
  [WS_EVENTS.rtcProducerPause]: (payload: RtcProducerPausePayload) => void;
  [WS_EVENTS.rtcConsume]: (
    payload: RtcConsumePayload,
    ack?: (res: RtcConsumeAck) => void,
  ) => void;
  [WS_EVENTS.rtcConsumerPause]: (
    payload: RtcConsumerPausePayload,
    ack?: (res: RtcAck) => void,
  ) => void;
  [WS_EVENTS.rtcConsumerLayers]: (payload: RtcConsumerLayersPayload) => void;
  [WS_EVENTS.rtcModerate]: (payload: RtcModeratePayload) => void;
  [WS_EVENTS.qaAsk]: (payload: QaAskPayload) => void;
  [WS_EVENTS.qaVote]: (payload: QaVotePayload) => void;
  [WS_EVENTS.qaStatus]: (payload: QaStatusPayload) => void;
}
