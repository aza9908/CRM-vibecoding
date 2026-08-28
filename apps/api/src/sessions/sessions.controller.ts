import { randomUUID } from 'node:crypto';
import {
  BadRequestException,
  Controller,
  forwardRef,
  Get,
  Inject,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import type { Request } from 'express';
import { eq, inArray } from 'drizzle-orm';
import {
  createSessionSchema,
  joinSessionSchema,
  setFocusSchema,
  saveSessionResponseSchema,
  sendSessionChatSchema,
  uploadResponseFileSchema,
  type AuthUserPayload,
  type CreateSessionDto,
  type JoinSessionDto,
  type JoinSessionResult,
  type LiveSessionMetrics,
  type ParticipantPayload,
  type SetFocusDto,
  type SaveSessionResponseDto,
  type UploadResponseFileDto,
  type SendSessionChatDto,
} from '@lms/shared';
import { ZodBody } from '../common/zod-body.decorator';
import { DRIZZLE, type Db } from '../db/db.module';
import {
  participants,
  lessonBlocks,
  lessons,
  liveSessions,
  responses,
} from '../db/schema';
import { AuthService } from '../auth/auth.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { UserOrParticipantGuard } from '../auth/guards/user-or-participant.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { SessionsService } from './sessions.service';
import { ResponsesService } from '../responses/responses.service';
import { SessionGateway } from '../realtime/session.gateway';
import { ActivityService } from '../progress/activity.service';
import { SessionChatService } from './session-chat.service';
import { MAX_DB_OBJECT_BYTES, StorageService } from '../storage/storage.service';

/** Key prefix for student-submitted files/screenshots on `input_file` blocks. */
const SESSION_RESPONSES_PREFIX = 'session-responses';
/** Marker prefix stored in `responses.answerText` for a file/screenshot answer. */
const FILE_ANSWER_PREFIX = 'file:';
/** Roles allowed to review a student's `input_file` submission. */
const TEACHER_LIKE_ROLES = new Set(['teacher', 'admin', 'team_lead']);

/**
 * REST surface for live sessions (docs/04 §3).
 *
 * Teacher endpoints are scoped to the caller's org via SessionsService
 * (assertSessionInOrg / assertLessonInOrg). `POST /sessions/join` is public —
 * the code is the access secret — and issues a participant-audience JWT.
 */
@Controller('sessions')
export class SessionsController {
  constructor(
    private readonly sessions: SessionsService,
    private readonly responses: ResponsesService,
    private readonly chat: SessionChatService,
    private readonly auth: AuthService,
    @Inject(forwardRef(() => SessionGateway))
    private readonly gateway: SessionGateway,
    @Inject(DRIZZLE) private readonly db: Db,
    private readonly activity: ActivityService,
    private readonly storage: StorageService,
  ) {}

  /** POST /sessions — teacher starts a live session for one of their lessons. */
  @Post()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('teacher', 'methodist', 'admin')
  async start(
    @CurrentUser() user: AuthUserPayload,
    @ZodBody(createSessionSchema) dto: CreateSessionDto,
  ) {
    return this.sessions.startSession(user.orgId, user.sub, dto.lessonId);
  }

  /**
   * POST /sessions/join — public entry by code. Creates a participant row for
   * the live session and returns a participant-scoped token. No org scoping:
   * the joiner has no user JWT, the 6-char code is the access secret.
   */
  @Post('join')
  async join(
    @ZodBody(joinSessionSchema) dto: JoinSessionDto,
  ): Promise<JoinSessionResult> {
    const session = await this.sessions.findLiveByCode(dto.code);
    if (!session) throw new NotFoundException('session_not_found');

    const [participant] = await this.db
      .insert(participants)
      .values({
        sessionId: session.id,
        name: dto.name,
        userId: dto.userId ?? null,
      })
      .returning();

    const participantToken = this.auth.issueParticipantToken(
      participant.id,
      session.id,
    );

    // Analytics: record a `session_join` only for authenticated joiners (a
    // user account joining by code). Anonymous guests are deliberately not
    // attributed (docs/08 §5). org comes from the session, not from input.
    if (participant.userId && session.organizationId) {
      await this.activity.writeLog({
        orgId: session.organizationId,
        userId: participant.userId,
        action: 'session_join',
        lessonId: session.lessonId ?? null,
        metadata: { sessionId: session.id, participantId: participant.id },
      });
    }

    return {
      participantToken,
      sessionId: session.id,
      participantId: participant.id,
    };
  }

  /**
   * GET /sessions/live — the teacher's currently-running sessions (org-scoped),
   * so the lessons dashboard can offer "вернуться в live" after a closed tab.
   * Declared before `:id` so the literal path isn't captured by the UUID param.
   */
  @Get('live')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('teacher', 'methodist', 'admin')
  async live(@CurrentUser() user: AuthUserPayload) {
    return this.sessions.listLiveForOrg(user.orgId);
  }

  /**
   * GET /sessions/:id — session state + the lesson's blocks. Read by BOTH the
   * teacher who owns the session (a user token, org-scoped) and joined students
   * (a participant token, scoped to their own session). The guard accepts either
   * audience; here we branch on it: participants may only read the session their
   * token was issued for, users must own the session's org. Both unauthorized
   * cases surface as 404 so cross-tenant existence is never leaked.
   */
  @Get(':id')
  @UseGuards(UserOrParticipantGuard)
  async getState(
    @Req() req: Request,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    const principal = req.user as AuthUserPayload | ParticipantPayload;
    if (principal.aud === 'participant') {
      if (principal.sessionId !== id) {
        throw new NotFoundException('session_not_found');
      }
    } else {
      await this.sessions.assertSessionInOrg(id, principal.orgId);
    }
    const session = await this.sessions.get(id);
    const blocks = session.lessonId
      ? await this.db
          .select()
          .from(lessonBlocks)
          .where(eq(lessonBlocks.lessonId, session.lessonId))
          .orderBy(lessonBlocks.orderIndex)
      : [];
    // Flat shape: the web SessionState reads code/status/focusedBlockId/blocks
    // at the top level (mirrors GET /lessons/:id returning { ...lesson, blocks }).
    return { ...session, blocks };
  }

  /**
   * GET /sessions/:id/my-responses — the caller's OWN responses for this
   * session, so the client can seed answered-state on (re)entry. Reachable by
   * both a joined participant (their token's participantId) and a logged-in
   * user (their participant row in this session, if they joined). Unauthorized
   * / not-joined cases return an empty list rather than leaking existence.
   */
  @Get(':id/my-responses')
  @UseGuards(UserOrParticipantGuard)
  async myResponses(
    @Req() req: Request,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    const principal = req.user as AuthUserPayload | ParticipantPayload;

    let participantId: string | null;
    if (principal.aud === 'participant') {
      // A participant token is bound to one session — refuse cross-session reads.
      if (principal.sessionId !== id) {
        throw new NotFoundException('session_not_found');
      }
      participantId = principal.sub;
    } else {
      // A logged-in user: must own the session's org, then map to their own
      // participant row for this session (null if they never joined).
      await this.sessions.assertSessionInOrg(id, principal.orgId);
      participantId = await this.sessions.findUserParticipant(
        id,
        principal.sub,
      );
    }

    if (!participantId) return [];
    return this.responses.listForParticipant(participantId);
  }

  /**
   * GET /sessions/:id/live-metrics — roster + progress for the live session.
   * Teachers (org-scoped) and joined participants may call this. Peer answer
   * text is never included — only names and completion %.
   */
  @Get(':id/live-metrics')
  @UseGuards(UserOrParticipantGuard)
  async liveMetrics(
    @Req() req: Request,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<LiveSessionMetrics> {
    const principal = req.user as AuthUserPayload | ParticipantPayload;
    if (principal.aud === 'participant') {
      if (principal.sessionId !== id) {
        throw new NotFoundException('session_not_found');
      }
    } else {
      // Teachers/admins in the org only — not every student JWT in the tenant.
      if (principal.role !== 'teacher' && principal.role !== 'admin') {
        throw new NotFoundException('session_not_found');
      }
      await this.sessions.assertSessionInOrg(id, principal.orgId);
    }

    const session = await this.db.query.liveSessions.findFirst({
      where: eq(liveSessions.id, id),
    });
    if (!session) throw new NotFoundException('session_not_found');

    let lessonTitle: string | null = null;
    if (session.lessonId) {
      const lesson = await this.db.query.lessons.findFirst({
        where: eq(lessons.id, session.lessonId),
      });
      lessonTitle = lesson?.title ?? null;
    }

    const interactiveTypes = [
      'input_text',
      'input_select',
      'input_rating',
      'input_file',
      'test',
    ] as const;
    const blocks = session.lessonId
      ? await this.db
          .select({ id: lessonBlocks.id, type: lessonBlocks.type })
          .from(lessonBlocks)
          .where(eq(lessonBlocks.lessonId, session.lessonId))
      : [];
    const interactive = blocks.filter((b) =>
      (interactiveTypes as readonly string[]).includes(b.type),
    );
    const totalInteractive = interactive.length;

    const parts = await this.db
      .select()
      .from(participants)
      .where(eq(participants.sessionId, id));

    const partIds = parts.map((p) => p.id);
    const respRows =
      partIds.length === 0
        ? []
        : await this.db
            .select()
            .from(responses)
            .where(inArray(responses.participantId, partIds));

    const answered = new Map<string, Set<string>>();
    for (const r of respRows) {
      if (!r.participantId || !r.blockId) continue;
      if (r.answerText == null || String(r.answerText).trim() === '') continue;
      let set = answered.get(r.participantId);
      if (!set) {
        set = new Set();
        answered.set(r.participantId, set);
      }
      set.add(r.blockId);
    }

    const interactiveIds = new Set(interactive.map((b) => b.id));
    const roster = parts.map((p) => {
      const done = [...(answered.get(p.id) ?? [])].filter((bid) =>
        interactiveIds.has(bid),
      ).length;
      const progressPercent =
        totalInteractive === 0
          ? 0
          : Math.round((done / totalInteractive) * 100);
      return {
        participantId: p.id,
        name: p.name,
        progressPercent,
      };
    });

    const avgProgress =
      roster.length === 0
        ? 0
        : Math.round(
            roster.reduce((s, r) => s + r.progressPercent, 0) / roster.length,
          );
    const attended = roster.filter((r) => r.progressPercent > 0).length;
    const attendanceScore =
      roster.length === 0
        ? 0
        : Math.round((attended / roster.length) * 100);

    const result: LiveSessionMetrics = {
      sessionId: id,
      lessonTitle,
      status: session.status,
      totals: {
        participants: roster.length,
        avgProgress,
        attendanceScore,
      },
      roster,
    };

    if (principal.aud === 'participant') {
      const mine = roster.find((r) => r.participantId === principal.sub);
      if (mine) result.me = mine;
    }

    return result;
  }

  /** GET /sessions/:id/participants — teacher-only roster, org-scoped. */
  @Get(':id/participants')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('teacher', 'methodist', 'admin')
  async participants(
    @CurrentUser() user: AuthUserPayload,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    await this.sessions.assertSessionInOrg(id, user.orgId);
    return this.db
      .select()
      .from(participants)
      .where(eq(participants.sessionId, id));
  }

  /** GET /sessions/:id/responses — teacher-only answer summary, org-scoped. */
  @Get(':id/responses')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('teacher', 'methodist', 'admin')
  async responsesSummary(
    @CurrentUser() user: AuthUserPayload,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    await this.sessions.assertSessionInOrg(id, user.orgId);
    return this.responses.listForSession(id);
  }

  /**
   * POST /sessions/:id/responses — participant saves an answer over REST.
   * This is the reliable path for App Hosting (WS may drop); teacher polls GET.
   */
  @Post(':id/responses')
  @UseGuards(UserOrParticipantGuard)
  async saveResponse(
    @Req() req: Request,
    @Param('id', new ParseUUIDPipe()) id: string,
    @ZodBody(saveSessionResponseSchema) body: SaveSessionResponseDto,
  ) {
    const principal = req.user as AuthUserPayload | ParticipantPayload;
    if (principal.aud !== 'participant' || principal.sessionId !== id) {
      throw new NotFoundException('session_not_found');
    }
    const saved = await this.responses.upsert(
      principal.sub,
      body.blockId,
      body.answerText,
      body.completed,
    );
    // Best-effort WS fanout for teachers who are listening.
    this.gateway.broadcastResponseUpdated(id, {
      participantId: principal.sub,
      blockId: body.blockId,
      answerText: body.answerText,
      at: (saved?.updatedAt ?? new Date()).toISOString(),
    });
    return {
      ok: true,
      blockId: body.blockId,
      updatedAt: saved?.updatedAt ?? new Date(),
    };
  }

  /**
   * POST /sessions/:id/responses/upload — a participant submits a file or
   * screenshot for an `input_file` block. Deliberately a narrow,
   * session-scoped endpoint (not a widened generic `/uploads` guard) so a
   * participant never gains a general upload capability, only one scoped to
   * their own session's response — matches the project's tenant/participant
   * isolation discipline. Stores the object, then saves the response with the
   * `file:<key>` convention and `completed: true`, same as a text answer.
   */
  @Post(':id/responses/upload')
  @UseGuards(UserOrParticipantGuard)
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: MAX_DB_OBJECT_BYTES },
    }),
  )
  async uploadResponseFile(
    @Req() req: Request,
    @Param('id', new ParseUUIDPipe()) id: string,
    @UploadedFile() file: Express.Multer.File | undefined,
    @ZodBody(uploadResponseFileSchema) body: UploadResponseFileDto,
  ) {
    const principal = req.user as AuthUserPayload | ParticipantPayload;
    if (principal.aud !== 'participant' || principal.sessionId !== id) {
      throw new NotFoundException('session_not_found');
    }
    if (!file?.buffer?.length) {
      throw new BadRequestException('file_required');
    }

    const safeName = (file.originalname || 'upload.bin').replace(
      /[^\w.\-]+/g,
      '_',
    );
    const key = `${SESSION_RESPONSES_PREFIX}/${id}/${randomUUID()}-${safeName}`;
    await this.storage.putObject(
      key,
      file.buffer,
      file.mimetype || 'application/octet-stream',
    );

    const saved = await this.responses.upsert(
      principal.sub,
      body.blockId,
      `${FILE_ANSWER_PREFIX}${key}`,
      true,
    );
    this.gateway.broadcastResponseUpdated(id, {
      participantId: principal.sub,
      blockId: body.blockId,
      answerText: `${FILE_ANSWER_PREFIX}${key}`,
      at: (saved?.updatedAt ?? new Date()).toISOString(),
    });
    return {
      ok: true,
      blockId: body.blockId,
      fileName: file.originalname,
      updatedAt: saved?.updatedAt ?? new Date(),
    };
  }

  /**
   * GET /sessions/:id/responses/:participantId/:blockId/download — resolve a
   * presigned download URL for a `file:<key>` answer. Reachable by the
   * answer's own participant (self-download) or a teacher/admin/team_lead in
   * the session's org (reviewing a student's submission); either mismatch is
   * a 404, matching the project's cross-tenant-never-leaks convention.
   */
  @Get(':id/responses/:participantId/:blockId/download')
  @UseGuards(UserOrParticipantGuard)
  async downloadResponseFile(
    @Req() req: Request,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('participantId', new ParseUUIDPipe()) participantId: string,
    @Param('blockId', new ParseUUIDPipe()) blockId: string,
  ): Promise<{ url: string }> {
    const principal = req.user as AuthUserPayload | ParticipantPayload;
    if (principal.aud === 'participant') {
      if (principal.sessionId !== id || principal.sub !== participantId) {
        throw new NotFoundException('response_not_found');
      }
    } else {
      // Reviewing a student's submission is a teacher/admin/team_lead action,
      // matching this endpoint's own doc comment — a `student` in the same
      // org must not be able to fetch a classmate's file this way.
      if (!TEACHER_LIKE_ROLES.has(principal.role)) {
        throw new NotFoundException('response_not_found');
      }
      await this.sessions.assertSessionInOrg(id, principal.orgId);
    }

    const response = await this.responses.getOne(participantId, blockId);
    if (!response?.answerText?.startsWith(FILE_ANSWER_PREFIX)) {
      throw new NotFoundException('response_not_found');
    }
    const key = response.answerText.slice(FILE_ANSWER_PREFIX.length);
    const url = await this.storage.getSignedGetUrl(key, 300, {
      requestOrigin: this.requestApiOrigin(req),
    });
    return { url };
  }

  private requestApiOrigin(req: Request): string {
    const proto = String(req.headers['x-forwarded-proto'] ?? req.protocol);
    const host = String(
      req.headers['x-forwarded-host'] ?? req.headers.host ?? '',
    );
    return host ? `${proto}://${host}` : '';
  }

  /** GET /sessions/:id/chat — group chat history (teacher or participant). */
  @Get(':id/chat')
  @UseGuards(UserOrParticipantGuard)
  async listChat(
    @Req() req: Request,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    const principal = req.user as AuthUserPayload | ParticipantPayload;
    if (principal.aud === 'participant') {
      if (principal.sessionId !== id) {
        throw new NotFoundException('session_not_found');
      }
    } else {
      await this.sessions.assertSessionInOrg(id, principal.orgId);
    }
    return this.chat.list(id);
  }

  /** POST /sessions/:id/chat — send a group chat message (REST). */
  @Post(':id/chat')
  @UseGuards(UserOrParticipantGuard)
  async postChat(
    @Req() req: Request,
    @Param('id', new ParseUUIDPipe()) id: string,
    @ZodBody(sendSessionChatSchema) body: SendSessionChatDto,
  ) {
    const principal = req.user as AuthUserPayload | ParticipantPayload;
    let senderName = 'Участник';
    let role: 'teacher' | 'participant' = 'participant';
    const senderId = principal.sub;

    if (principal.aud === 'participant') {
      if (principal.sessionId !== id) {
        throw new NotFoundException('session_not_found');
      }
      senderName =
        (await this.sessions.getParticipantName(principal.sub)) ?? 'Участник';
      role = 'participant';
    } else {
      await this.sessions.assertSessionInOrg(id, principal.orgId);
      if (principal.role === 'teacher' || principal.role === 'admin') {
        role = 'teacher';
        senderName = 'Преподаватель';
      }
    }

    const message = await this.chat.post({
      sessionId: id,
      senderId,
      senderName,
      role,
      text: body.text,
    });

    this.gateway.broadcastChatMessage(id, {
      id: message.id,
      sessionId: message.sessionId,
      senderId: message.senderId,
      senderName: message.senderName,
      role: message.role,
      text: message.text,
      at: message.at,
    });

    return message;
  }

  /**
   * POST /sessions/:id/end — teacher ends the session (status=ended, endTime
   * stamped, code freed). After the status is persisted we ask the gateway to
   * broadcast `session:ended` to everyone in the room.
   */
  @Post(':id/end')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('teacher', 'methodist', 'admin')
  async end(
    @CurrentUser() user: AuthUserPayload,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    await this.sessions.endSession(user.orgId, id);
    this.gateway.broadcastSessionEnded(id);
    return { ok: true, sessionId: id };
  }

  /**
   * POST /sessions/:id/focus — REST fallback for teacher focus (also broadcasts
   * over WS). Used when Socket.IO focus:set is flaky on a network.
   */
  @Post(':id/focus')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('teacher', 'methodist', 'admin')
  async setFocus(
    @CurrentUser() user: AuthUserPayload,
    @Param('id', new ParseUUIDPipe()) id: string,
    @ZodBody(setFocusSchema) body: SetFocusDto,
  ) {
    await this.sessions.assertSessionInOrg(id, user.orgId);
    await this.sessions.setFocus(id, body.blockId);
    await this.gateway.broadcastFocus(id, body.blockId);
    return { ok: true, blockId: body.blockId };
  }
}
