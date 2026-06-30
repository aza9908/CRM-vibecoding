import { Logger, UseGuards } from '@nestjs/common';
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import {
  WS_EVENTS,
  WS_NAMESPACE,
  type AuthUserPayload,
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

/** Identity attached to a connected socket after handshake verification. */
type SocketIdentity = AuthUserPayload | ParticipantPayload;

/** Per-socket data: the verified identity, set on connection (else disconnect). */
interface LiveSocketData {
  identity?: SocketIdentity;
}

/** Our socket type carries the typed event maps and the verified identity. */
type LiveSocket = Socket<
  ClientToServerEvents,
  ServerToClientEvents,
  Record<string, never>,
  LiveSocketData
>;

type LiveServer = Server<ClientToServerEvents, ServerToClientEvents>;

/** Room name for a session. Kept in one place so it can't drift. */
const room = (sessionId: string) => `session:${sessionId}`;

function isParticipant(id: SocketIdentity): id is ParticipantPayload {
  return id.aud === 'participant';
}

/**
 * Realtime core for live sessions (docs/04 §4).
 *
 * Namespace `/live`, rooms `session:{id}`. The token is verified once on
 * connection (accepts both `user` and `participant` audiences) and the payload
 * is stashed on `socket.data.identity`. Authorization on individual messages
 * is enforced from that identity:
 *   - a participant may only join its own session,
 *   - only a teacher may set focus (WsRolesGuard),
 *   - response updates are sent to the teacher only (socket.to(room)), never
 *     broadcast to all — see the 2000-connection notes in docs/04 §5.
 *
 * The Socket.IO server is shared with the HTTP server in main.ts, where the
 * Redis adapter is wired so `io.to(room).emit(...)` reaches sockets on other
 * API instances.
 */
@WebSocketGateway({
  namespace: WS_NAMESPACE,
  cors: { origin: process.env.WEB_ORIGIN, credentials: true },
})
export class SessionGateway implements OnGatewayConnection {
  @WebSocketServer() io!: LiveServer;

  private readonly logger = new Logger(SessionGateway.name);

  constructor(
    private readonly auth: AuthService,
    private readonly sessions: SessionsService,
    private readonly responses: ResponsesService,
  ) {}

  /**
   * Verify the handshake token before any message is processed. The client
   * passes it as `auth.token` in the Socket.IO handshake. Either audience is
   * accepted; a failure disconnects the socket immediately.
   */
  async handleConnection(socket: LiveSocket): Promise<void> {
    const token = this.extractToken(socket);
    if (!token) {
      this.logger.debug(`socket ${socket.id} rejected: missing token`);
      socket.disconnect();
      return;
    }
    try {
      const payload = await this.auth.verifySocketToken(token);
      socket.data.identity = payload;
    } catch {
      this.logger.debug(`socket ${socket.id} rejected: invalid token`);
      socket.disconnect();
    }
  }

  /**
   * Join the room for a session. A participant may join only the session its
   * token is scoped to. On join the socket receives the current focus state so
   * a late joiner lands on the right block; a participant join is announced to
   * the rest of the room (the teacher) via `participant:joined`.
   */
  @SubscribeMessage(WS_EVENTS.sessionJoin)
  async onJoin(
    @ConnectedSocket() socket: LiveSocket,
    @MessageBody() body: SessionJoinPayload,
  ): Promise<void> {
    const identity = socket.data.identity;
    if (!identity) {
      socket.disconnect();
      return;
    }
    const { sessionId } = body;

    if (isParticipant(identity) && identity.sessionId !== sessionId) {
      // A participant token is bound to one session; refuse cross-session joins.
      this.logger.warn(
        `participant ${identity.sub} attempted to join foreign session ${sessionId}`,
      );
      return;
    }

    await socket.join(room(sessionId));

    // Send the current focused block to the joiner only.
    const session = await this.sessions.get(sessionId);
    socket.emit(WS_EVENTS.focusChanged, {
      blockId: session.focusedBlockId ?? null,
    });

    // Announce participants to the rest of the room (the teacher) — light payload.
    if (isParticipant(identity)) {
      const name = await this.sessions.getParticipantName(identity.sub);
      socket.to(room(sessionId)).emit(WS_EVENTS.participantJoined, {
        participantId: identity.sub,
        name: name ?? 'Participant',
      });
    }
  }

  /**
   * Teacher focuses a block. Persisted (so late joiners see it) then broadcast
   * to everyone in the room as `focus:changed`. Guarded by WsRolesGuard +
   * @Roles('teacher') — participants cannot drive focus.
   */
  @UseGuards(WsRolesGuard)
  @Roles('teacher')
  @SubscribeMessage(WS_EVENTS.focusSet)
  async onFocus(
    @ConnectedSocket() socket: LiveSocket,
    @MessageBody() body: FocusSetPayload,
  ): Promise<void> {
    const { sessionId, blockId } = body;
    await this.sessions.setFocus(sessionId, blockId);
    this.io.to(room(sessionId)).emit(WS_EVENTS.focusChanged, { blockId });
  }

  /**
   * Student saves/updates an answer. Persisted via upsert, then a light delta
   * is sent to the teacher only — `socket.to(room)` excludes the sender and we
   * never broadcast answers to other students (docs/04 §5).
   */
  @SubscribeMessage(WS_EVENTS.responseSave)
  async onResponse(
    @ConnectedSocket() socket: LiveSocket,
    @MessageBody() body: ResponseSavePayload,
  ): Promise<void> {
    const identity = socket.data.identity;
    if (!identity) {
      socket.disconnect();
      return;
    }
    // Only a participant authors responses; the sub is the participantId.
    if (!isParticipant(identity)) return;
    if (identity.sessionId !== body.sessionId) return;

    const participantId = identity.sub;
    const saved = await this.responses.upsert(
      participantId,
      body.blockId,
      body.answerText,
    );

    socket.to(room(body.sessionId)).emit(WS_EVENTS.responseUpdated, {
      participantId,
      blockId: body.blockId,
      answerText: body.answerText,
      at: (saved?.updatedAt ?? new Date()).toISOString(),
    });
  }

  /**
   * Broadcast that a session has ended. Called by the REST `POST /sessions/:id/end`
   * handler (via the controller) after the status transition is persisted, so
   * the emit stays inside the realtime layer that owns the Socket.IO server.
   * Every socket in the room — teacher and students — receives `session:ended`.
   */
  broadcastSessionEnded(sessionId: string): void {
    this.io.to(room(sessionId)).emit(WS_EVENTS.sessionEnded, { sessionId });
  }

  private extractToken(socket: LiveSocket): string | undefined {
    const fromAuth = socket.handshake.auth?.token;
    if (typeof fromAuth === 'string' && fromAuth.length > 0) return fromAuth;
    const header = socket.handshake.headers?.authorization;
    if (typeof header === 'string' && header.startsWith('Bearer ')) {
      return header.slice('Bearer '.length);
    }
    return undefined;
  }
}
