import {
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { and, asc, eq, inArray } from 'drizzle-orm';
import type {
  BlockType,
  RatingMetric,
  SessionListItem,
  SessionReport,
  SessionReportBlock,
  SessionReportParticipant,
  TestMetric,
} from '@lms/shared';

import { DRIZZLE, type Db } from '../db/db.module';
import {
  lessonBlocks,
  lessons,
  liveSessions,
  participants,
  responses,
} from '../db/schema';

type BlockRow = typeof lessonBlocks.$inferSelect;
type ParticipantRow = typeof participants.$inferSelect;
type ResponseRow = typeof responses.$inferSelect;
type SessionRow = typeof liveSessions.$inferSelect;

/**
 * Block kinds the student is expected to act on. Progress = answered
 * interactive blocks / total interactive blocks. Pure-content blocks (text /
 * image) and `action_button` don't count toward completion.
 */
const INTERACTIVE_BLOCK_TYPES: ReadonlySet<BlockType> = new Set<BlockType>([
  'input_text',
  'input_select',
  'input_rating',
  'input_file',
  'test',
]);

const isInteractive = (b: BlockRow): boolean =>
  INTERACTIVE_BLOCK_TYPES.has(b.type as BlockType);

/** One row of an export CSV: exactly one participant answer to one block. */
export interface ExportRow {
  session_code: string;
  participant: string;
  block: string;
  question: string;
  answer: string;
  completed: boolean;
  at: string;
}

/** The hierarchical JSON payload returned by the export endpoint (json format). */
export interface ExportData {
  lesson: { id: string; title: string };
  generatedAt: string;
  sessions: Array<{
    session: {
      id: string;
      code: string;
      status: SessionListItem['status'];
      startTime: string | null;
      endTime: string | null;
    };
    report: SessionReport;
  }>;
  rows: ExportRow[];
}

/**
 * Teacher-facing reporting over live sessions (docs/09 §4–5).
 *
 * Every public method takes the caller's `orgId` and asserts the target lesson
 * or session belongs to it BEFORE touching any child rows, so cross-tenant
 * access is impossible. Lessons are scoped via their direct `organizationId`
 * column (never through module → course); sessions via their own
 * `organizationId`. Cross-tenant reads surface as 404 so existence is not
 * leaked (the one exception: {@link assertSessionInOrg} mirrors the existing
 * SessionsService contract and raises 403 when the session exists but belongs
 * to another org).
 */
@Injectable()
export class ReportsService {
  constructor(@Inject(DRIZZLE) private readonly db: Db) {}

  /**
   * `GET /lessons/:id/sessions` — the lesson's sessions with per-session
   * counters (participants, responses) plus status and timing. Scoped: the
   * lesson must belong to `orgId`.
   */
  async listLessonSessions(
    orgId: string,
    lessonId: string,
  ): Promise<SessionListItem[]> {
    await this.assertLessonInOrg(lessonId, orgId);

    const sessions = await this.db
      .select()
      .from(liveSessions)
      .where(eq(liveSessions.lessonId, lessonId))
      .orderBy(asc(liveSessions.createdAt));

    if (sessions.length === 0) return [];

    // Pull all participants for these sessions in one query, then their
    // responses, so counting is two round-trips regardless of session count.
    const sessionIds = sessions.map((s) => s.id);
    const parts = await this.db
      .select({ id: participants.id, sessionId: participants.sessionId })
      .from(participants)
      .where(inArray(participants.sessionId, sessionIds));

    const participantToSession = new Map<string, string>();
    const participantCountBySession = new Map<string, number>();
    for (const p of parts) {
      if (!p.sessionId) continue;
      participantToSession.set(p.id, p.sessionId);
      participantCountBySession.set(
        p.sessionId,
        (participantCountBySession.get(p.sessionId) ?? 0) + 1,
      );
    }

    const responseCountBySession = new Map<string, number>();
    const participantIds = parts.map((p) => p.id);
    if (participantIds.length > 0) {
      const resp = await this.db
        .select({ participantId: responses.participantId })
        .from(responses)
        .where(inArray(responses.participantId, participantIds));
      for (const r of resp) {
        const sessionId = r.participantId
          ? participantToSession.get(r.participantId)
          : undefined;
        if (!sessionId) continue;
        responseCountBySession.set(
          sessionId,
          (responseCountBySession.get(sessionId) ?? 0) + 1,
        );
      }
    }

    return sessions.map((s) => ({
      id: s.id,
      code: s.code,
      status: s.status,
      participantCount: participantCountBySession.get(s.id) ?? 0,
      responseCount: responseCountBySession.get(s.id) ?? 0,
      startTime: s.startTime ? s.startTime.toISOString() : null,
      endTime: s.endTime ? s.endTime.toISOString() : null,
      createdAt: s.createdAt ? s.createdAt.toISOString() : null,
    }));
  }

  /**
   * `GET /sessions/:id/report` — the detailed per-session report (docs/09 §4):
   * grouped by participant (with progress over interactive blocks and their
   * answers) and by block (with each participant's answer), plus totals and
   * rating/test metrics. Scoped: the session must belong to `orgId`.
   */
  async sessionReport(
    orgId: string,
    sessionId: string,
  ): Promise<SessionReport> {
    await this.assertSessionInOrg(sessionId, orgId);

    const { session, blocks, parts, resp } =
      await this.loadSessionGraph(sessionId);

    const report = this.buildReport(session, blocks, parts, resp);

    return {
      ...report,
      ratings: this.ratingMetrics(blocks, resp),
      tests: this.testMetrics(blocks, resp),
    };
  }

  /**
   * Aggregate everything needed for an export of one lesson (docs/09 §5).
   * Returns both the hierarchical JSON shape and a flat row-per-response list
   * the controller can serialize to CSV. Scoped: the lesson must belong to
   * `orgId`.
   */
  async aggregateForExport(
    orgId: string,
    lessonId: string,
  ): Promise<ExportData> {
    const lesson = await this.assertLessonInOrg(lessonId, orgId);

    const sessions = await this.db
      .select()
      .from(liveSessions)
      .where(eq(liveSessions.lessonId, lessonId))
      .orderBy(asc(liveSessions.createdAt));

    const out: ExportData = {
      lesson: { id: lesson.id, title: lesson.title },
      generatedAt: new Date().toISOString(),
      sessions: [],
      rows: [],
    };

    for (const s of sessions) {
      const { session, blocks, parts, resp } = await this.loadSessionGraph(
        s.id,
        s,
      );
      const report = this.buildReport(session, blocks, parts, resp);

      out.sessions.push({
        session: {
          id: session.id,
          code: session.code,
          status: session.status,
          startTime: session.startTime
            ? session.startTime.toISOString()
            : null,
          endTime: session.endTime ? session.endTime.toISOString() : null,
        },
        report,
      });

      const blockById = new Map(blocks.map((b) => [b.id, b]));
      const nameById = new Map(parts.map((p) => [p.id, p.name]));
      for (const r of resp) {
        const block = r.blockId ? blockById.get(r.blockId) : undefined;
        out.rows.push({
          session_code: session.code,
          participant: r.participantId
            ? (nameById.get(r.participantId) ?? '')
            : '',
          block: block ? (block.type as string) : '',
          question: block?.content ?? '',
          answer: r.answerText ?? '',
          completed: r.isCompleted ?? false,
          at: r.updatedAt ? r.updatedAt.toISOString() : '',
        });
      }
    }

    return out;
  }

  // ── internals ─────────────────────────────────────────────────────────────

  /**
   * Load a session and its block/participant/response graph in three queries.
   * `known` lets the export path pass the already-fetched session row to avoid
   * a redundant round-trip.
   */
  private async loadSessionGraph(
    sessionId: string,
    known?: SessionRow,
  ): Promise<{
    session: SessionRow;
    blocks: BlockRow[];
    parts: ParticipantRow[];
    resp: ResponseRow[];
  }> {
    const session =
      known ??
      (await this.db.query.liveSessions.findFirst({
        where: eq(liveSessions.id, sessionId),
      }));
    if (!session) throw new NotFoundException('session_not_found');

    const blocks = session.lessonId
      ? await this.db
          .select()
          .from(lessonBlocks)
          .where(eq(lessonBlocks.lessonId, session.lessonId))
          .orderBy(asc(lessonBlocks.orderIndex))
      : [];

    const parts = await this.db
      .select()
      .from(participants)
      .where(eq(participants.sessionId, sessionId));

    const partIds = parts.map((p) => p.id);
    const resp = partIds.length
      ? await this.db
          .select()
          .from(responses)
          .where(inArray(responses.participantId, partIds))
      : [];

    return { session, blocks, parts, resp };
  }

  /** Shared report builder used by both sessionReport and the export path. */
  private buildReport(
    session: SessionRow,
    blocks: BlockRow[],
    parts: ParticipantRow[],
    resp: ResponseRow[],
  ): SessionReport {
    const interactive = blocks.filter(isInteractive);

    const byParticipant: SessionReportParticipant[] = parts.map((p) => {
      const mine = resp.filter((r) => r.participantId === p.id);
      const done = mine.filter(
        (r) => r.isCompleted && interactive.some((b) => b.id === r.blockId),
      ).length;
      return {
        participant: { id: p.id, name: p.name },
        progressPercent: interactive.length
          ? Math.round((done / interactive.length) * 100)
          : 0,
        answers: mine.map((r) => ({
          blockId: r.blockId ?? '',
          answerText: r.answerText,
          isCompleted: r.isCompleted ?? false,
          updatedAt: r.updatedAt ? r.updatedAt.toISOString() : null,
        })),
      };
    });

    const nameById = new Map(parts.map((p) => [p.id, p.name]));
    const byBlock: SessionReportBlock[] = blocks.map((b) => ({
      block: { id: b.id, type: b.type as BlockType, content: b.content },
      responses: resp
        .filter((r) => r.blockId === b.id)
        .map((r) => ({
          participant: r.participantId
            ? (nameById.get(r.participantId) ?? null)
            : null,
          answer: r.answerText,
          at: r.updatedAt ? r.updatedAt.toISOString() : null,
        })),
    }));

    const avgProgress = byParticipant.length
      ? Math.round(
          byParticipant.reduce((sum, x) => sum + x.progressPercent, 0) /
            byParticipant.length,
        )
      : 0;

    return {
      session: {
        id: session.id,
        code: session.code,
        status: session.status,
        lessonId: session.lessonId ?? null,
        startTime: session.startTime ? session.startTime.toISOString() : null,
        endTime: session.endTime ? session.endTime.toISOString() : null,
      },
      totals: {
        participants: parts.length,
        responses: resp.length,
        avgProgress,
      },
      byParticipant,
      byBlock,
    };
  }

  /**
   * Per-block aggregates for `input_rating` blocks: average value and a
   * distribution keyed by the numeric rating. Non-numeric / empty answers are
   * ignored. The block `options` payload is free-form jsonb, so we read values
   * defensively.
   */
  private ratingMetrics(blocks: BlockRow[], resp: ResponseRow[]): RatingMetric[] {
    return blocks
      .filter((b) => (b.type as BlockType) === 'input_rating')
      .map((b) => {
        const values = resp
          .filter((r) => r.blockId === b.id && r.answerText != null)
          .map((r) => Number(r.answerText))
          .filter((n) => Number.isFinite(n));

        const distribution: Record<string, number> = {};
        for (const v of values) {
          const key = String(v);
          distribution[key] = (distribution[key] ?? 0) + 1;
        }

        const sum = values.reduce((a, n) => a + n, 0);
        const average = values.length
          ? Math.round((sum / values.length) * 10) / 10
          : 0;

        return {
          blockId: b.id,
          content: b.content,
          average,
          count: values.length,
          distribution,
        };
      });
  }

  /**
   * Per-block aggregates for `test` blocks: percentage of answers that match
   * the correct option(s). The correct set comes from the block's
   * `options.correct` (free-form jsonb — `{ items, correct }`, where `correct`
   * may be an array of option values or a single value). An answer counts as
   * correct when it equals one of the correct values (string-compared).
   */
  private testMetrics(blocks: BlockRow[], resp: ResponseRow[]): TestMetric[] {
    return blocks
      .filter((b) => (b.type as BlockType) === 'test')
      .map((b) => {
        const correct = this.extractCorrect(b.options);
        const answers = resp
          .filter((r) => r.blockId === b.id && r.answerText != null)
          .map((r) => r.answerText as string);

        const correctCount = answers.filter((a) =>
          correct.has(a.trim()),
        ).length;
        const total = answers.length;

        return {
          blockId: b.id,
          content: b.content,
          correctPercent: total
            ? Math.round((correctCount / total) * 100)
            : 0,
          total,
          correct: correctCount,
        };
      });
  }

  /**
   * Pull the set of correct answer values out of a block's free-form `options`
   * jsonb (`{ correct: ... }`). Accepts an array or a single scalar; everything
   * is normalized to trimmed strings for comparison. Returns an empty set when
   * the shape is unrecognized.
   */
  private extractCorrect(options: unknown): Set<string> {
    const out = new Set<string>();
    if (options == null || typeof options !== 'object') return out;
    const raw = (options as Record<string, unknown>).correct;
    const push = (v: unknown): void => {
      if (v == null) return;
      out.add(String(v).trim());
    };
    if (Array.isArray(raw)) {
      for (const v of raw) push(v);
    } else {
      push(raw);
    }
    return out;
  }

  /**
   * Assert a lesson exists and belongs to `orgId` via its direct
   * `organization_id` (never module → course). Returns the lesson row. Throws
   * 404 otherwise so other tenants' lessons are never revealed.
   */
  private async assertLessonInOrg(
    lessonId: string,
    orgId: string,
  ): Promise<typeof lessons.$inferSelect> {
    const [row] = await this.db
      .select()
      .from(lessons)
      .where(and(eq(lessons.id, lessonId), eq(lessons.organizationId, orgId)))
      .limit(1);

    if (!row) throw new NotFoundException('lesson_not_found');
    return row;
  }

  /**
   * Assert a session exists and belongs to `orgId`. Mirrors
   * `SessionsService.assertSessionInOrg`: 404 if missing, 403 if it belongs to
   * another org.
   */
  private async assertSessionInOrg(
    sessionId: string,
    orgId: string,
  ): Promise<void> {
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
