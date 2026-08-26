import { Logger, UseGuards } from '@nestjs/common';
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayInit,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { randomUUID } from 'crypto';
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
  type ResponseSavePayload,
  type ServerToClientEvents,
  type SessionJoinPayload,
} from '@lms/shared';
import { AuthService } from '../auth/auth.service';
import { Roles } from '../auth/decorators/roles.decorator';
import { WsRolesGuard } from '../auth/guards/ws-roles.guard';
import { SessionsService } from '../sessions/sessions.service';
import { ResponsesService } from '../responses/responses.service';

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

const CHAT_MAX_LEN = 500;
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
export class SessionGateway implements OnGatewayInit, OnGatewayConnection {
  @WebSocketServer() io!: LiveServer;

  private readonly logger = new Logger(SessionGateway.name);
  private readonly chatBySession = new Map<string, ChatMessagePayload[]>();
  private readonly chatRate = new Map<string, number[]>();

  constructor(
    private readonly auth: AuthService,
    private readonly sessions: SessionsService,
    private readonly responses: ResponsesService,
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
    this.logger.log('Socket.IO /live middleware auth installed');
  }

  handleConnection(socket: LiveSocket): void {
    const id = socket.data.identity;
    this.logger.debug(
      `WS connected ${socket.id} aud=${id?.aud ?? '?'} sub=${id?.sub ?? '?'}`,
    );
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

    if (
      !isParticipant(identity) &&
      (identity.role === 'teacher' || identity.role === 'admin')
    ) {
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
  @Roles('teacher', 'admin')
  @SubscribeMessage(WS_EVENTS.focusSet)
  async onFocus(
    @ConnectedSocket() socket: LiveSocket,
    @MessageBody() body: FocusSetPayload,
  ): Promise<{ ok: boolean }> {
    const identity = socket.data.identity;
    if (!identity || isParticipant(identity)) {
      return { ok: false };
    }
    if (identity.role !== 'teacher' && identity.role !== 'admin') {
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
      if (
        !isParticipant(identity) &&
        (identity.role === 'teacher' || identity.role === 'admin')
      ) {
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
    } else if (identity.role === 'teacher' || identity.role === 'admin') {
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
