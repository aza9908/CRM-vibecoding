import {
  ForbiddenException,
  Inject,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { randomInt } from 'node:crypto';
import { and, desc, eq } from 'drizzle-orm';
import { DRIZZLE, type Db } from '../db/db.module';
import { lessons, liveSessions, participants } from '../db/schema';

/**
 * Alphabet for session codes: A-Z and 0-9, minus visually ambiguous
 * characters (0/O, 1/I). 6 chars from this 32-char set gives ~1.07e9
 * combinations — collisions among *live* sessions are vanishingly rare and, if
 * they happen, are caught by the partial unique index and retried.
 */
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const CODE_LENGTH = 6;
const CODE_GEN_ATTEMPTS = 5;

/** Postgres unique-violation error code. */
const PG_UNIQUE_VIOLATION = '23505';

@Injectable()
export class SessionsService {
  constructor(@Inject(DRIZZLE) private readonly db: Db) {}

  /**
   * Generate a 6-char A-Z0-9 code (ambiguous chars excluded) that is not
   * currently in use by another *live* session. The partial unique index
   * (`code` WHERE status='live') is the real guard against races; this check
   * just avoids the obvious clash before the insert. Uses crypto.randomInt for
   * unbiased, unpredictable codes.
   */
  private randomCode(): string {
    let code = '';
    for (let i = 0; i < CODE_LENGTH; i++) {
      code += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
    }
    return code;
  }

  private async generateUniqueCode(): Promise<string> {
    for (let i = 0; i < CODE_GEN_ATTEMPTS; i++) {
      const code = this.randomCode();
      const clash = await this.db.query.liveSessions.findFirst({
        where: and(eq(liveSessions.code, code), eq(liveSessions.status, 'live')),
      });
      if (!clash) return code;
    }
    throw new InternalServerErrorException('code_gen_failed');
  }

  /**
   * Verify a lesson belongs to the caller's org before starting a session for
   * it, via the lesson's direct organizationId. Throws 404 if the lesson does
   * not exist or is not in this org (don't leak existence).
   */
  private async assertLessonInOrg(
    lessonId: string,
    orgId: string,
  ): Promise<void> {
    const [row] = await this.db
      .select({ id: lessons.id })
      .from(lessons)
      .where(and(eq(lessons.id, lessonId), eq(lessons.organizationId, orgId)))
      .limit(1);

    if (!row) throw new NotFoundException('lesson_not_found');
  }

  /**
   * Start a live session for a lesson: generate a unique code and insert a row
   * with status='live'. Scoped: the lesson must belong to `orgId`. On the rare
   * code race (caught by the partial unique index) we retry once with a fresh
   * code. The returned row carries the code the teacher shows to students.
   */
  async startSession(orgId: string, teacherId: string, lessonId: string) {
    await this.assertLessonInOrg(lessonId, orgId);

    // Resume the existing live session for this lesson instead of spawning a
    // duplicate. This is what lets a teacher who closed the tab re-enter the
    // same room (same code, same students) just by hitting "go live" again —
    // and it keeps the rule "at most one live session per lesson".
    const existing = await this.db.query.liveSessions.findFirst({
      where: and(
        eq(liveSessions.lessonId, lessonId),
        eq(liveSessions.organizationId, orgId),
        eq(liveSessions.status, 'live'),
      ),
    });
    if (existing) return existing;

    for (let attempt = 0; attempt < 2; attempt++) {
      const code = await this.generateUniqueCode();
      try {
        const [session] = await this.db
          .insert(liveSessions)
          .values({
            lessonId,
            organizationId: orgId,
            code,
            status: 'live',
            startTime: new Date(),
          })
          .returning();
        return session;
      } catch (err) {
        if (this.isUniqueViolation(err) && attempt === 0) {
          // Another request grabbed this code first; retry with a new one.
          continue;
        }
        throw err;
      }
    }

    throw new InternalServerErrorException('code_gen_failed');
  }

  private isUniqueViolation(err: unknown): boolean {
    return (
      typeof err === 'object' &&
      err !== null &&
      'code' in err &&
      (err as { code?: unknown }).code === PG_UNIQUE_VIOLATION
    );
  }

  /**
   * Find the single live session for a code. Used by the public join flow
   * (`POST /sessions/join`) — no org scoping here because the joiner has no JWT
   * yet; the code itself is the access secret. Returns undefined if no live
   * session matches.
   */
  async findLiveByCode(code: string) {
    return this.db.query.liveSessions.findFirst({
      where: and(eq(liveSessions.code, code), eq(liveSessions.status, 'live')),
    });
  }

  /**
   * All currently-live sessions in an org, newest first. Powers the teacher's
   * "вернуться в live" affordance on the lessons dashboard so a closed tab is
   * recoverable. Org-scoped; never leaks other tenants' sessions.
   */
  async listLiveForOrg(orgId: string) {
    return this.db
      .select({
        id: liveSessions.id,
        code: liveSessions.code,
        lessonId: liveSessions.lessonId,
        startTime: liveSessions.startTime,
      })
      .from(liveSessions)
      .where(
        and(
          eq(liveSessions.organizationId, orgId),
          eq(liveSessions.status, 'live'),
        ),
      )
      .orderBy(desc(liveSessions.startTime));
  }

  /** Load a session by id, or throw 404. Used by the gateway and controllers. */
  async get(sessionId: string) {
    const session = await this.db.query.liveSessions.findFirst({
      where: eq(liveSessions.id, sessionId),
    });
    if (!session) throw new NotFoundException('session_not_found');
    return session;
  }

  /**
   * Persist the teacher's focused block. Called from the WS `focus:set`
   * handler before broadcasting `focus:changed`, so a late joiner who hits
   * `get(sessionId)` (or the GET endpoint) sees the current focus.
   */
  async setFocus(sessionId: string, blockId: string) {
    await this.db
      .update(liveSessions)
      .set({ focusedBlockId: blockId })
      .where(eq(liveSessions.id, sessionId));
  }

  /**
   * End a session: set status='ended' and stamp endTime. Scoped: the session
   * must belong to `orgId`. Once ended, the code is freed (the partial unique
   * index only constrains live rows), so it can be reused by a future session.
   * The `session:ended` broadcast is emitted by the gateway, not here.
   */
  async endSession(orgId: string, sessionId: string) {
    await this.assertSessionInOrg(sessionId, orgId);
    await this.db
      .update(liveSessions)
      .set({ status: 'ended', endTime: new Date() })
      .where(eq(liveSessions.id, sessionId));
  }

  /**
   * Look up a participant's display name. Used by the realtime gateway to
   * enrich the `participant:joined` payload. Returns null if not found (the
   * caller falls back to a generic label) — best-effort, never throws.
   */
  async getParticipantName(participantId: string): Promise<string | null> {
    const row = await this.db.query.participants.findFirst({
      where: eq(participants.id, participantId),
      columns: { name: true },
    });
    return row?.name ?? null;
  }

  /**
   * Find the participant row this `userId` joined `sessionId` with, if any.
   * Used by `GET /sessions/:id/my-responses` to map a logged-in user to their
   * own participant identity for that session. Returns the participant id or
   * null when the user never joined.
   */
  async findUserParticipant(
    sessionId: string,
    userId: string,
  ): Promise<string | null> {
    const row = await this.db.query.participants.findFirst({
      where: and(
        eq(participants.sessionId, sessionId),
        eq(participants.userId, userId),
      ),
      columns: { id: true },
    });
    return row?.id ?? null;
  }

  /**
   * Assert that a session exists and belongs to `orgId`. Throws 404 if missing
   * and 403 if it belongs to another org. Every teacher-facing session
   * operation funnels through this for tenant isolation.
   */
  async assertSessionInOrg(sessionId: string, orgId: string): Promise<void> {
    const session = await this.db.query.liveSessions.findFirst({
      where: eq(liveSessions.id, sessionId),
      columns: { id: true, organizationId: true },
    });
    if (!session) throw new NotFoundException('session_not_found');
    if (session.organizationId !== orgId) {
      throw new ForbiddenException('session_forbidden');
    }
  }
}
