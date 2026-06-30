import {
  Controller,
  forwardRef,
  Get,
  Inject,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { eq } from 'drizzle-orm';
import {
  createSessionSchema,
  joinSessionSchema,
  type AuthUserPayload,
  type CreateSessionDto,
  type JoinSessionDto,
  type JoinSessionResult,
  type ParticipantPayload,
} from '@lms/shared';
import { ZodBody } from '../common/zod-body.decorator';
import { DRIZZLE, type Db } from '../db/db.module';
import { participants, lessonBlocks } from '../db/schema';
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
    private readonly auth: AuthService,
    @Inject(forwardRef(() => SessionGateway))
    private readonly gateway: SessionGateway,
    @Inject(DRIZZLE) private readonly db: Db,
    private readonly activity: ActivityService,
  ) {}

  /** POST /sessions — teacher starts a live session for one of their lessons. */
  @Post()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('teacher')
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
  @Roles('teacher')
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

  /** GET /sessions/:id/participants — teacher-only roster, org-scoped. */
  @Get(':id/participants')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('teacher')
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
  @Roles('teacher')
  async responsesSummary(
    @CurrentUser() user: AuthUserPayload,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    await this.sessions.assertSessionInOrg(id, user.orgId);
    return this.responses.listForSession(id);
  }

  /**
   * POST /sessions/:id/end — teacher ends the session (status=ended, endTime
   * stamped, code freed). After the status is persisted we ask the gateway to
   * broadcast `session:ended` to everyone in the room.
   */
  @Post(':id/end')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('teacher')
  async end(
    @CurrentUser() user: AuthUserPayload,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    await this.sessions.endSession(user.orgId, id);
    // Status is now persisted as ended; tell everyone in the room over WS.
    this.gateway.broadcastSessionEnded(id);
    return { ok: true, sessionId: id };
  }
}
