import { Logger, UseGuards } from '@nestjs/common';
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  OnGatewayInit,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { createHash, randomUUID } from 'crypto';
import { Server, Socket } from 'socket.io';
import {
  WS_EVENTS,
  WS_NAMESPACE,
  type AuthUserPayload,
  type ChatMessagePayload,
  type ChatSendPayload,
  type ClientToServerEvents,
  type FocusSetPayload,
  type ParticipantPayload,
  type QaAskPayload,
  type QaQuestion,
  type QaStatusPayload,
  type QaVotePayload,
  type ResponseSavePayload,
  type RtcAck,
  type RtcCallEndPayload,
  type RtcConsumeAck,
  type RtcConsumePayload,
  type RtcConsumerLayersPayload,
  type RtcConsumerPausePayload,
  type RtcJoinAck,
  type RtcProduceAck,
  type RtcProducePayload,
  type RtcProducerClosePayload,
  type RtcProducerPausePayload,
  type RtcTransportConnectPayload,
  type RtcTransportCreateAck,
  type RtcTransportCreatePayload,
  type RtcTransportRestartIceAck,
  type RtcTransportRestartIcePayload,
  type RtcJoinPayload,
  type RtcLeavePayload,
  type RtcModeratePayload,
  type RtcPeer,
  type RtcStatePayload,
  type ServerToClientEvents,
  type SessionJoinPayload,
} from '@lms/shared';
import { AuthService } from '../auth/auth.service';
import { Roles } from '../auth/decorators/roles.decorator';
import { WsRolesGuard } from '../auth/guards/ws-roles.guard';
import { SessionsService } from '../sessions/sessions.service';
import { ResponsesService } from '../responses/responses.service';
import {
  VIDEO_ROOM_MAX_PEERS,
  VideoRoomService,
  isRtcSource,
  sanitizeMedia,
} from './video-room.service';

type SocketIdentity = AuthUserPayload | ParticipantPayload;

interface LiveSocketData {
  identity?: SocketIdentity;
}

type LiveSocket = Socket<
  ClientToServerEvents,
  ServerToClientEvents,
  Record<string, never>,
  LiveSocketData
>;

type LiveServer = Server<ClientToServerEvents, ServerToClientEvents>;

const room = (sessionId: string) => `session:${sessionId}`;
const teachersRoom = (sessionId: string) => `session:${sessionId}:teachers`;
const rtcRoom = (sessionId: string) => `session:${sessionId}:rtc`;

/** Teacher/Methodist/Admin have identical live-session permissions
 * (TZ_LMS_roles_promocodes.md §3.1). Only checked on non-participant
 * identities — callers must guard `isParticipant()` first. */
const isStaffRole = (role: AuthUserPayload['role']): boolean =>
  role === 'teacher' || role === 'methodist' || role === 'admin';

const CHAT_MAX_LEN = 500;
const QA_MAX_LEN = 300;
const QA_CAP = 100;
const CHAT_HISTORY_CAP = 100;

function isParticipant(id: SocketIdentity): id is ParticipantPayload {
  return id.aud === 'participant';
}

function parseCorsOrigin(): string | string[] | boolean {
  const raw = process.env.WEB_ORIGIN ?? '*';
  if (raw === '*') return true;
  const list = raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  return list.length <= 1 ? (list[0] ?? true) : list;
}

/**
 * Realtime core for live sessions.
 *
 * Auth runs in Socket.IO middleware (before `connection`) so `session:join`
 * never races an empty `socket.data.identity` — that race was breaking focus,
 * chat, and answer sync in production.
 */
@WebSocketGateway({
  namespace: WS_NAMESPACE,
  cors: { origin: parseCorsOrigin(), credentials: true },
  transports: ['websocket', 'polling'],
})
export class SessionGateway
  implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect
{
  @WebSocketServer() io!: LiveServer;

  private readonly logger = new Logger(SessionGateway.name);
  private readonly chatBySession = new Map<string, ChatMessagePayload[]>();
  private readonly chatRate = new Map<string, number[]>();
  /** Q&A queue per session — in-memory like the chat buffer. */
  private readonly qaBySession = new Map<string, QaQuestion[]>();

  constructor(
    private readonly auth: AuthService,
    private readonly sessions: SessionsService,
    private readonly responses: ResponsesService,
    private readonly video: VideoRoomService,
  ) {}

  /**
   * Authenticate BEFORE the socket is fully connected. Fixes the race where
   * the client emits `session:join` on `connect` while handleConnection is
   * still verifying the JWT.
   */
  afterInit(server: LiveServer): void {
    server.use(async (socket, next) => {
      try {
        const token = this.extractToken(socket as LiveSocket);
        if (!token) {
          next(new Error('missing_token'));
          return;
        }
        const payload = await this.auth.verifySocketToken(token);
        (socket.data as LiveSocketData).identity = payload;
        next();
      } catch (err) {
        this.logger.debug(
          `WS auth failed: ${err instanceof Error ? err.message : String(err)}`,
        );
        next(new Error('unauthorized'));
      }
    });
    this.video.onSpeakers = (sessionId, speakers) => {
      this.io?.to(rtcRoom(sessionId)).emit(WS_EVENTS.rtcSpeakers, { speakers });
    };
    this.video.onIdle = (sessionId) => this.endCall(sessionId);
    this.video.onReset = (sessionIds) => {
      for (const id of sessionIds) this.io?.to(rtcRoom(id)).emit(WS_EVENTS.rtcReset);
    };
    this.logger.log('Socket.IO /live middleware auth installed');
  }

  handleConnection(socket: LiveSocket): void {
    const id = socket.data.identity;
    this.logger.debug(
      `WS connected ${socket.id} aud=${id?.aud ?? '?'} sub=${id?.sub ?? '?'}`,
    );
  }

  handleDisconnect(socket: LiveSocket): void {
    this.leaveVideo(socket);
  }

  // ── Video room ─────────────────────────────────────────────────────────
  // Media goes through the server-side SFU (VideoRoomService). This gateway
  // authorises people, keeps the roster and carries the SFU signaling.

  /**
   * Who may enter a session's video room:
   *  - a participant token issued for THIS session;
   *  - a user account whose org owns the session (staff become hosts).
   */
  private async videoIdentity(
    identity: SocketIdentity,
    sessionId: string,
  ): Promise<{ role: RtcPeer['role']; name: string } | null> {
    let session;
    try {
      session = await this.sessions.get(sessionId);
    } catch {
      return null;
    }
    if (session.status === 'ended') return null;
    if (isParticipant(identity)) {
      if (identity.sessionId !== sessionId) return null;
      const name = await this.sessions.getParticipantName(identity.sub);
      return { role: 'participant', name: name ?? 'Участник' };
    }
    if (!identity.orgId || session.organizationId !== identity.orgId) {
      return null;
    }
    const name = await this.sessions.getUserName(identity.sub);
    const host = isStaffRole(identity.role);
    return {
      role: host ? 'host' : 'participant',
      name: name ?? (host ? 'Преподаватель' : 'Участник'),
    };
  }

  @SubscribeMessage(WS_EVENTS.rtcJoin)
  async onRtcJoin(
    @ConnectedSocket() socket: LiveSocket,
    @MessageBody() body: RtcJoinPayload,
  ): Promise<RtcJoinAck> {
    const identity = socket.data.identity;
    const sessionId = body?.sessionId;
    if (!identity || typeof sessionId !== 'string') {
      return { ok: false, error: 'bad_request' };
    }
    const who = await this.videoIdentity(identity, sessionId);
    if (!who) return { ok: false, error: 'forbidden' };

    // Stable id per (account, tab): a reload or reconnect replaces the old
    // entry instead of showing the person twice. Bound to the token's
    // subject so nobody can take over someone else's id.
    const clientId =
      typeof body.clientId === 'string' && /^[\w-]{8,64}$/.test(body.clientId)
        ? body.clientId
        : socket.id;
    const peerId = createHash('sha256')
      .update(`${identity.sub}:${clientId}`)
      .digest('hex')
      .slice(0, 20);

    // One video room per socket — re-joining replaces the previous entry.
    this.leaveVideo(socket, { silent: true });
    const returning = !!this.video.peer(sessionId, peerId);
    if (!returning && this.video.size(sessionId) >= VIDEO_ROOM_MAX_PEERS) {
      return { ok: false, error: 'room_full' };
    }

    const peer: RtcPeer = {
      peerId,
      name: who.name,
      role: who.role,
      media: sanitizeMedia(body.media),
    };
    let added;
    try {
      added = await this.video.add(sessionId, socket.id, peer);
    } catch (err) {
      this.logger.error(`rtc join failed: ${err instanceof Error ? err.message : String(err)}`);
      return { ok: false, error: 'media_unavailable' };
    }
    if (added.replacedSocketId && added.replacedSocketId !== socket.id) {
      void this.io.in(added.replacedSocketId).socketsLeave(rtcRoom(sessionId));
    }
    await socket.join(rtcRoom(sessionId));
    socket.to(rtcRoom(sessionId)).emit(WS_EVENTS.rtcPeerJoined, peer);
    this.broadcastRoomState(sessionId);
    return {
      ok: true,
      selfId: peerId,
      role: who.role,
      peers: this.video.peers(sessionId).filter((p) => p.peerId !== peerId),
      producers: this.video.producers(sessionId, peerId),
      routerRtpCapabilities: this.video.routerCapabilities(sessionId),
      startedAt: this.video.state(sessionId).startedAt,
    };
  }

  @SubscribeMessage(WS_EVENTS.rtcLeave)
  onRtcLeave(@ConnectedSocket() socket: LiveSocket): void {
    this.leaveVideo(socket);
  }

  /** Host ends the call for everybody. */
  @SubscribeMessage(WS_EVENTS.rtcCallEnd)
  onRtcCallEnd(
    @ConnectedSocket() socket: LiveSocket,
    @MessageBody() body: RtcCallEndPayload,
  ): void {
    const me = this.video.peerOfSocket(socket.id);
    if (!me || me.sessionId !== body?.sessionId || me.info.role !== 'host') return;
    this.endCall(me.sessionId);
  }

  private endCall(sessionId: string): void {
    this.io?.to(rtcRoom(sessionId)).emit(WS_EVENTS.rtcCallEnded, { sessionId });
    this.video.close(sessionId);
    this.io?.in(rtcRoom(sessionId)).socketsLeave(rtcRoom(sessionId));
    this.broadcastRoomState(sessionId);
  }

  @SubscribeMessage(WS_EVENTS.rtcState)
  onRtcState(
    @ConnectedSocket() socket: LiveSocket,
    @MessageBody() body: RtcStatePayload,
  ): void {
    const me = this.video.peerOfSocket(socket.id);
    if (!me || body?.sessionId !== me.sessionId) return;
    const media = sanitizeMedia(body.media);
    this.video.setMedia(me, media);
    socket
      .to(rtcRoom(me.sessionId))
      .emit(WS_EVENTS.rtcPeerState, { peerId: me.info.peerId, media });
  }

  @SubscribeMessage(WS_EVENTS.rtcTransportCreate)
  async onRtcTransportCreate(
    @ConnectedSocket() socket: LiveSocket,
    @MessageBody() body: RtcTransportCreatePayload,
  ): Promise<RtcTransportCreateAck> {
    const me = this.video.peerOfSocket(socket.id);
    const direction = body?.direction;
    if (!me || (direction !== 'send' && direction !== 'recv')) {
      return { ok: false, error: 'bad_request' };
    }
    try {
      const params = await this.video.createTransport(me);
      this.video.tagTransport(me, params.id, direction);
      return { ok: true, params };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : 'failed' };
    }
  }

  @SubscribeMessage(WS_EVENTS.rtcTransportConnect)
  async onRtcTransportConnect(
    @ConnectedSocket() socket: LiveSocket,
    @MessageBody() body: RtcTransportConnectPayload,
  ): Promise<RtcAck> {
    const me = this.video.peerOfSocket(socket.id);
    if (!me || typeof body?.transportId !== 'string') {
      return { ok: false, error: 'bad_request' };
    }
    try {
      await this.video.connectTransport(me, body.transportId, body.dtlsParameters);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : 'failed' };
    }
  }

  @SubscribeMessage(WS_EVENTS.rtcTransportRestartIce)
  async onRtcTransportRestartIce(
    @ConnectedSocket() socket: LiveSocket,
    @MessageBody() body: RtcTransportRestartIcePayload,
  ): Promise<RtcTransportRestartIceAck> {
    const me = this.video.peerOfSocket(socket.id);
    if (!me || typeof body?.transportId !== 'string') {
      return { ok: false, error: 'bad_request' };
    }
    try {
      return { ok: true, iceParameters: await this.video.restartIce(me, body.transportId) };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : 'failed' };
    }
  }

  @SubscribeMessage(WS_EVENTS.rtcProduce)
  async onRtcProduce(
    @ConnectedSocket() socket: LiveSocket,
    @MessageBody() body: RtcProducePayload,
  ): Promise<RtcProduceAck> {
    const me = this.video.peerOfSocket(socket.id);
    if (
      !me ||
      typeof body?.transportId !== 'string' ||
      (body.kind !== 'audio' && body.kind !== 'video') ||
      !isRtcSource(body.source)
    ) {
      return { ok: false, error: 'bad_request' };
    }
    const audioSource = body.source === 'mic' || body.source === 'screen-audio';
    if (audioSource !== (body.kind === 'audio')) {
      return { ok: false, error: 'bad_request' };
    }
    try {
      const info = await this.video.produce(
        me,
        body.transportId,
        body.kind,
        body.rtpParameters,
        body.source,
      );
      const sessionId = me.sessionId;
      const owner = me;
      // Tell the room when this producer goes away (close, leave, replace).
      owner.producers.get(info.producerId)?.observer.on('close', () => {
        this.io?.to(rtcRoom(sessionId)).emit(WS_EVENTS.rtcProducerClosed, {
          producerId: info.producerId,
          peerId: info.peerId,
        });
      });
      socket.to(rtcRoom(sessionId)).emit(WS_EVENTS.rtcProducerNew, info);
      return { ok: true, producerId: info.producerId };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : 'failed' };
    }
  }

  @SubscribeMessage(WS_EVENTS.rtcProducerClose)
  onRtcProducerClose(
    @ConnectedSocket() socket: LiveSocket,
    @MessageBody() body: RtcProducerClosePayload,
  ): void {
    const me = this.video.peerOfSocket(socket.id);
    if (!me || typeof body?.producerId !== 'string') return;
    this.video.closeProducer(me, body.producerId);
  }

  @SubscribeMessage(WS_EVENTS.rtcProducerPause)
  async onRtcProducerPause(
    @ConnectedSocket() socket: LiveSocket,
    @MessageBody() body: RtcProducerPausePayload,
  ): Promise<void> {
    const me = this.video.peerOfSocket(socket.id);
    if (!me || typeof body?.producerId !== 'string') return;
    await this.video
      .pauseProducer(me, body.producerId, body.paused === true)
      .catch(() => undefined);
  }

  @SubscribeMessage(WS_EVENTS.rtcConsume)
  async onRtcConsume(
    @ConnectedSocket() socket: LiveSocket,
    @MessageBody() body: RtcConsumePayload,
  ): Promise<RtcConsumeAck> {
    const me = this.video.peerOfSocket(socket.id);
    if (!me || typeof body?.producerId !== 'string') {
      return { ok: false, error: 'bad_request' };
    }
    try {
      const params = await this.video.consume(
        me,
        body.producerId,
        body.rtpCapabilities,
        () => undefined,
      );
      return { ok: true, params };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : 'failed' };
    }
  }

  @SubscribeMessage(WS_EVENTS.rtcConsumerPause)
  async onRtcConsumerPause(
    @ConnectedSocket() socket: LiveSocket,
    @MessageBody() body: RtcConsumerPausePayload,
  ): Promise<RtcAck> {
    const me = this.video.peerOfSocket(socket.id);
    if (!me || typeof body?.consumerId !== 'string') {
      return { ok: false, error: 'bad_request' };
    }
    const ok = await this.video
      .pauseConsumer(me, body.consumerId, body.paused === true)
      .catch(() => false);
    return { ok };
  }

  @SubscribeMessage(WS_EVENTS.rtcConsumerLayers)
  async onRtcConsumerLayers(
    @ConnectedSocket() socket: LiveSocket,
    @MessageBody() body: RtcConsumerLayersPayload,
  ): Promise<void> {
    const me = this.video.peerOfSocket(socket.id);
    if (!me || typeof body?.consumerId !== 'string') return;
    await this.video.setConsumerLayer(me, body.consumerId, Number(body.spatialLayer) || 0);
  }

  @SubscribeMessage(WS_EVENTS.rtcModerate)
  onRtcModerate(
    @ConnectedSocket() socket: LiveSocket,
    @MessageBody() body: RtcModeratePayload,
  ): void {
    const me = this.video.peerOfSocket(socket.id);
    if (!me || body?.sessionId !== me.sessionId || me.info.role !== 'host') return;
    const sessionId = me.sessionId;
    const action = body.action;
    if (action !== 'mute' && action !== 'stop-video' && action !== 'lower-hand') {
      return;
    }
    if (body.target === '*') {
      socket.to(rtcRoom(sessionId)).emit(WS_EVENTS.rtcModerate, { action });
      return;
    }
    const target =
      typeof body.target === 'string' ? this.video.peer(sessionId, body.target) : undefined;
    if (target) this.io.to(target.socketId).emit(WS_EVENTS.rtcModerate, { action });
  }

  /**
   * The socket's peer leaves the room. The call itself keeps running — it
   * ends only when a host ends it or the session ends.
   */
  private leaveVideo(socket: LiveSocket, opts: { silent?: boolean } = {}): void {
    const peer = this.video.removeSocket(socket.id);
    if (!peer) return;
    void socket.leave(rtcRoom(peer.sessionId));
    // Replaced by a newer socket of the same tab → not a real departure.
    const current = this.video.peer(peer.sessionId, peer.info.peerId);
    if (current) return;
    this.io
      ?.to(rtcRoom(peer.sessionId))
      .emit(WS_EVENTS.rtcPeerLeft, { peerId: peer.info.peerId });
    if (!opts.silent) this.broadcastRoomState(peer.sessionId);
  }

  /** Everyone in the session learns whether a call is running (auto-join). */
  private broadcastRoomState(sessionId: string): void {
    this.io
      ?.to(room(sessionId))
      .emit(WS_EVENTS.rtcRoomState, { sessionId, ...this.video.state(sessionId) });
  }

  @SubscribeMessage(WS_EVENTS.sessionJoin)
  async onJoin(
    @ConnectedSocket() socket: LiveSocket,
    @MessageBody() body: SessionJoinPayload,
  ): Promise<{ ok: boolean; focusedBlockId: string | null }> {
    const identity = socket.data.identity;
    if (!identity) {
      socket.disconnect();
      return { ok: false, focusedBlockId: null };
    }
    const sessionId = body?.sessionId;
    if (!sessionId) return { ok: false, focusedBlockId: null };

    if (isParticipant(identity) && identity.sessionId !== sessionId) {
      this.logger.warn(
        `participant ${identity.sub} attempted to join foreign session ${sessionId}`,
      );
      return { ok: false, focusedBlockId: null };
    }

    await socket.join(room(sessionId));

    if (!isParticipant(identity) && isStaffRole(identity.role)) {
      await socket.join(teachersRoom(sessionId));
    }

    let focusedBlockId: string | null = null;
    try {
      const session = await this.sessions.get(sessionId);
      focusedBlockId = session.focusedBlockId ?? null;
    } catch (err) {
      this.logger.warn(
        `session join get failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    socket.emit(WS_EVENTS.focusChanged, { blockId: focusedBlockId });

    const history = this.chatBySession.get(sessionId) ?? [];
    if (history.length > 0) {
      socket.emit(WS_EVENTS.chatHistory, { sessionId, messages: history });
    }
    socket.emit(WS_EVENTS.rtcRoomState, { sessionId, ...this.video.state(sessionId) });

    const questions = this.qaBySession.get(sessionId);
    if (questions?.length) {
      socket.emit(WS_EVENTS.qaList, { sessionId, questions });
    }

    if (isParticipant(identity)) {
      const name = await this.sessions.getParticipantName(identity.sub);
      const payload = {
        participantId: identity.sub,
        name: name ?? 'Participant',
      };
      // Teachers hear joins on both rooms (main + teachers).
      this.io.to(teachersRoom(sessionId)).emit(WS_EVENTS.participantJoined, payload);
      socket.to(room(sessionId)).emit(WS_EVENTS.participantJoined, payload);
    }

    return { ok: true, focusedBlockId };
  }

  @UseGuards(WsRolesGuard)
  @Roles('teacher', 'methodist', 'admin')
  @SubscribeMessage(WS_EVENTS.focusSet)
  async onFocus(
    @ConnectedSocket() socket: LiveSocket,
    @MessageBody() body: FocusSetPayload,
  ): Promise<{ ok: boolean }> {
    const identity = socket.data.identity;
    if (!identity || isParticipant(identity)) {
      return { ok: false };
    }
    if (!isStaffRole(identity.role)) {
      return { ok: false };
    }

    const { sessionId, blockId } = body ?? ({} as FocusSetPayload);
    if (!sessionId || !blockId) return { ok: false };

    // Ensure teacher is in the room even if join raced.
    await socket.join(room(sessionId));
    await socket.join(teachersRoom(sessionId));

    await this.sessions.setFocus(sessionId, blockId);
    this.io.to(room(sessionId)).emit(WS_EVENTS.focusChanged, { blockId });
    this.logger.debug(`focus set session=${sessionId} block=${blockId}`);
    return { ok: true };
  }

  @SubscribeMessage(WS_EVENTS.responseSave)
  async onResponse(
    @ConnectedSocket() socket: LiveSocket,
    @MessageBody() body: ResponseSavePayload,
  ): Promise<{ ok: boolean }> {
    const identity = socket.data.identity;
    if (!identity) {
      socket.disconnect();
      return { ok: false };
    }
    if (!isParticipant(identity)) return { ok: false };
    if (!body?.sessionId || !body.blockId) return { ok: false };
    if (identity.sessionId !== body.sessionId) return { ok: false };

    const participantId = identity.sub;
    const saved = await this.responses.upsert(
      participantId,
      body.blockId,
      body.answerText ?? '',
      body.completed,
    );

    const payload = {
      participantId,
      blockId: body.blockId,
      answerText: body.answerText ?? '',
      at: (saved?.updatedAt ?? new Date()).toISOString(),
    };

    // Teachers room (preferred) + main room fanout so a missed teachers-join
    // still delivers. Students listen but do not render peer answers in UI.
    this.io.to(teachersRoom(body.sessionId)).emit(WS_EVENTS.responseUpdated, payload);
    this.io.to(room(body.sessionId)).emit(WS_EVENTS.responseUpdated, payload);
    return { ok: true };
  }

  // ── Q&A ────────────────────────────────────────────────────────────────

  /** Resolve sender + make sure the socket may act in this session. */
  private async qaActor(
    socket: LiveSocket,
    sessionId: unknown,
  ): Promise<{ identity: SocketIdentity; sessionId: string } | null> {
    const identity = socket.data.identity;
    if (!identity || typeof sessionId !== 'string' || !sessionId) return null;
    if (isParticipant(identity) && identity.sessionId !== sessionId) return null;
    if (!socket.rooms.has(room(sessionId))) {
      // Same rule as session:join: users must belong to the session's org.
      if (!isParticipant(identity)) {
        try {
          await this.sessions.assertSessionInOrg(sessionId, identity.orgId);
        } catch {
          return null;
        }
      }
      await socket.join(room(sessionId));
    }
    return { identity, sessionId };
  }

  private broadcastQa(sessionId: string): void {
    const questions = this.qaBySession.get(sessionId) ?? [];
    this.io.to(room(sessionId)).emit(WS_EVENTS.qaList, { sessionId, questions });
  }

  @SubscribeMessage(WS_EVENTS.qaAsk)
  async onQaAsk(
    @ConnectedSocket() socket: LiveSocket,
    @MessageBody() body: QaAskPayload,
  ): Promise<{ ok: boolean }> {
    const actor = await this.qaActor(socket, body?.sessionId);
    const text = (typeof body?.text === 'string' ? body.text : '')
      .trim()
      .slice(0, QA_MAX_LEN);
    if (!actor || !text) return { ok: false };
    if (!this.allowChat(actor.identity.sub)) return { ok: false };
    const { identity, sessionId } = actor;
    const authorName = isParticipant(identity)
      ? ((await this.sessions.getParticipantName(identity.sub)) ?? 'Участник')
      : ((await this.sessions.getUserName(identity.sub)) ??
        (isStaffRole(identity.role) ? 'Преподаватель' : 'Участник'));
    const list = this.qaBySession.get(sessionId) ?? [];
    list.push({
      id: randomUUID(),
      sessionId,
      authorId: identity.sub,
      authorName,
      text,
      votes: 0,
      voterIds: [],
      status: 'open',
      at: new Date().toISOString(),
    });
    while (list.length > QA_CAP) list.shift();
    this.qaBySession.set(sessionId, list);
    this.broadcastQa(sessionId);
    return { ok: true };
  }

  @SubscribeMessage(WS_EVENTS.qaVote)
  async onQaVote(
    @ConnectedSocket() socket: LiveSocket,
    @MessageBody() body: QaVotePayload,
  ): Promise<{ ok: boolean }> {
    const actor = await this.qaActor(socket, body?.sessionId);
    if (!actor) return { ok: false };
    const q = this.qaBySession
      .get(actor.sessionId)
      ?.find((x) => x.id === body.questionId);
    if (!q || q.status === 'answered') return { ok: false };
    const me = actor.identity.sub;
    // Toggle: a second tap takes the vote back.
    q.voterIds = q.voterIds.includes(me)
      ? q.voterIds.filter((v) => v !== me)
      : [...q.voterIds, me];
    q.votes = q.voterIds.length;
    this.broadcastQa(actor.sessionId);
    return { ok: true };
  }

  @SubscribeMessage(WS_EVENTS.qaStatus)
  async onQaStatus(
    @ConnectedSocket() socket: LiveSocket,
    @MessageBody() body: QaStatusPayload,
  ): Promise<{ ok: boolean }> {
    const actor = await this.qaActor(socket, body?.sessionId);
    if (!actor) return { ok: false };
    const { identity, sessionId } = actor;
    if (isParticipant(identity) || !isStaffRole(identity.role)) {
      return { ok: false };
    }
    const status = body.status;
    if (status !== 'open' && status !== 'live' && status !== 'answered') {
      return { ok: false };
    }
    const list = this.qaBySession.get(sessionId) ?? [];
    const q = list.find((x) => x.id === body.questionId);
    if (!q) return { ok: false };
    // Only one question has the floor at a time.
    if (status === 'live') {
      for (const other of list) if (other.status === 'live') other.status = 'open';
    }
    q.status = status;
    this.broadcastQa(sessionId);
    if (status === 'live') {
      const sockets = await this.io.in(room(sessionId)).fetchSockets();
      for (const s of sockets) {
        const sid = (s.data as LiveSocketData).identity?.sub;
        if (sid === q.authorId) {
          s.emit(WS_EVENTS.qaFloor, { sessionId, questionId: q.id, text: q.text });
        }
      }
    }
    return { ok: true };
  }

  @SubscribeMessage(WS_EVENTS.chatSend)
  async onChat(
    @ConnectedSocket() socket: LiveSocket,
    @MessageBody() body: ChatSendPayload,
  ): Promise<{ ok: boolean }> {
    const identity = socket.data.identity;
    if (!identity) {
      socket.disconnect();
      return { ok: false };
    }
    const sessionId = body?.sessionId;
    const text = (body?.text ?? '').trim().slice(0, CHAT_MAX_LEN);
    if (!text || !sessionId) return { ok: false };

    if (isParticipant(identity) && identity.sessionId !== sessionId) {
      return { ok: false };
    }

    // Auto-join if the client skipped/raced session:join.
    if (!socket.rooms.has(room(sessionId))) {
      await socket.join(room(sessionId));
      if (!isParticipant(identity) && isStaffRole(identity.role)) {
        await socket.join(teachersRoom(sessionId));
      }
    }

    if (!this.allowChat(identity.sub)) return { ok: false };

    let senderName = 'Участник';
    let role: 'teacher' | 'participant' = 'participant';
    if (isParticipant(identity)) {
      senderName =
        (await this.sessions.getParticipantName(identity.sub)) ?? 'Участник';
      role = 'participant';
    } else if (isStaffRole(identity.role)) {
      role = 'teacher';
      senderName = 'Преподаватель';
    }

    const message: ChatMessagePayload = {
      id: randomUUID(),
      sessionId,
      senderId: identity.sub,
      senderName,
      role,
      text,
      at: new Date().toISOString(),
    };

    const buf = this.chatBySession.get(sessionId) ?? [];
    buf.push(message);
    while (buf.length > CHAT_HISTORY_CAP) buf.shift();
    this.chatBySession.set(sessionId, buf);

    this.io.to(room(sessionId)).emit(WS_EVENTS.chatMessage, message);
    return { ok: true };
  }

  /** Also used by REST POST /sessions/:id/focus as a WS-independent path. */
  async broadcastFocus(sessionId: string, blockId: string): Promise<void> {
    this.io?.to(room(sessionId)).emit(WS_EVENTS.focusChanged, { blockId });
  }

  broadcastResponseUpdated(
    sessionId: string,
    payload: {
      participantId: string;
      blockId: string;
      answerText: string;
      at: string;
    },
  ): void {
    this.io?.to(teachersRoom(sessionId)).emit(WS_EVENTS.responseUpdated, payload);
    this.io?.to(room(sessionId)).emit(WS_EVENTS.responseUpdated, payload);
  }

  broadcastChatMessage(sessionId: string, message: ChatMessagePayload): void {
    this.io?.to(room(sessionId)).emit(WS_EVENTS.chatMessage, message);
  }

  broadcastSessionEnded(sessionId: string): void {
    this.io?.to(room(sessionId)).emit(WS_EVENTS.sessionEnded, { sessionId });
    this.chatBySession.delete(sessionId);
    this.qaBySession.delete(sessionId);
    this.endCall(sessionId);
  }

  private allowChat(senderId: string): boolean {
    const now = Date.now();
    const windowMs = 10_000;
    const max = 8;
    const prev = (this.chatRate.get(senderId) ?? []).filter(
      (t) => now - t < windowMs,
    );
    if (prev.length >= max) {
      this.chatRate.set(senderId, prev);
      return false;
    }
    prev.push(now);
    this.chatRate.set(senderId, prev);
    return true;
  }

  private extractToken(socket: LiveSocket): string | undefined {
    const fromAuth = socket.handshake.auth?.token;
    if (typeof fromAuth === 'string' && fromAuth.length > 0) return fromAuth;
    const header = socket.handshake.headers?.authorization;
    if (typeof header === 'string' && header.startsWith('Bearer ')) {
      return header.slice('Bearer '.length);
    }
    const q = socket.handshake.query?.token;
    if (typeof q === 'string' && q.length > 0) return q;
    return undefined;
  }
}
