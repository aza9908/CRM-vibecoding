import {
  HttpException,
  HttpStatus,
  Injectable,
  Inject,
  Logger,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import type {
  AiReportLocale,
  AiReportStage,
  AiReportStatus,
  AnswersAnalysis,
  AnswersReport,
  AnswersReportStats,
  CuratorReport,
  CuratorReportRecord,
  CuratorReportsResponse,
  CuratorReportStats,
} from '@lms/shared';
import { DRIZZLE, type Db } from '../db/db.module';
import { aiReports } from '../db/schema';
import { SessionsService } from '../sessions/sessions.service';
import type { AgentContext } from './agent-context';
import { AnswersAgent } from './answers-agent';
import { CuratorAgent } from './curator-agent';
import { failureReason } from './llm-json';

type ReportRow = typeof aiReports.$inferSelect;

/** A whole job (all LLM calls) may take this long at most. */
const JOB_TIMEOUT_MS = 20 * 60_000;
/** Jobs of one organization waiting or running at once. */
const MAX_OPEN_JOBS_PER_ORG = 3;

/**
 * Job queue and storage of «ИИ-анализ ответов» and «ИИ-куратор» — the same
 * life cycle as «ИИ-разбор урока» (`analysis.service.ts`): a row is created
 * as `queued`, one in-memory queue runs jobs one at a time (the API is a
 * single instance), progress/stage are written as the job goes, the result
 * lands in `result` as `{ report, stats }`, and a failure is stored as a
 * machine-readable reason. A job that was running when the API restarted is
 * marked failed at boot.
 *
 * Starting is limited: one open job per session / company (asking again
 * returns it) and at most three open jobs per organization; on top of that
 * the global RateLimitGuard caps POSTs per person.
 *
 * Every read and write is scoped by `organization_id` from the JWT.
 */
@Injectable()
export class AiReportsService implements OnModuleInit {
  private readonly logger = new Logger(AiReportsService.name);
  private readonly queue: string[] = [];
  private running = false;

  constructor(
    @Inject(DRIZZLE) private readonly db: Db,
    private readonly sessions: SessionsService,
    private readonly answersAgent: AnswersAgent,
    private readonly curatorAgent: CuratorAgent,
  ) {}

  async onModuleInit(): Promise<void> {
    // Whatever was queued or running died with the previous process.
    try {
      await this.db
        .update(aiReports)
        .set({ status: 'failed', error: 'interrupted', finishedAt: new Date() })
        .where(inArray(aiReports.status, ['queued', 'processing']));
    } catch (err) {
      // The table may not exist yet on a database that is being migrated.
      this.logger.warn(`could not reset unfinished AI reports: ${String(err)}`);
    }
  }

  // ── rows ─────────────────────────────────────────────────────────────────

  private base(row: ReportRow) {
    return {
      id: row.id,
      status: row.status as AiReportStatus,
      progress: row.progress,
      stage: row.stage as AiReportStage,
      locale: row.locale as AiReportLocale,
      error: row.error,
      createdAt: row.createdAt.toISOString(),
      finishedAt: row.finishedAt ? row.finishedAt.toISOString() : null,
    };
  }

  private toAnswers(row: ReportRow): AnswersAnalysis {
    const result = row.result as { report?: AnswersReport; stats?: AnswersReportStats } | null;
    return {
      ...this.base(row),
      kind: 'answers',
      sessionId: row.sessionId!,
      report: result?.report ?? null,
      stats: result?.stats ?? null,
    };
  }

  private toCurator(row: ReportRow): CuratorReportRecord {
    const result = row.result as { report?: CuratorReport; stats?: CuratorReportStats } | null;
    return {
      ...this.base(row),
      kind: 'curator',
      category: row.category ?? '',
      report: result?.report ?? null,
      stats: result?.stats ?? null,
    };
  }

  private async openJobsOfOrg(orgId: string): Promise<number> {
    const [r] = await this.db
      .select({ n: sql<number>`count(*)::int` })
      .from(aiReports)
      .where(
        and(eq(aiReports.organizationId, orgId), inArray(aiReports.status, ['queued', 'processing'])),
      );
    return r?.n ?? 0;
  }

  private tooMany(): HttpException {
    return new HttpException({ message: 'too_many_ai_jobs' }, HttpStatus.TOO_MANY_REQUESTS);
  }

  // ── «ИИ-анализ ответов» ─────────────────────────────────────────────────

  /** Start the analysis of a session's answers (or return the open one). */
  async startAnswers(
    orgId: string,
    userId: string,
    sessionId: string,
    locale: AiReportLocale,
  ): Promise<AnswersAnalysis> {
    await this.sessions.assertSessionInOrg(sessionId, orgId);
    const open = await this.db.query.aiReports.findFirst({
      where: and(
        eq(aiReports.organizationId, orgId),
        eq(aiReports.kind, 'answers'),
        eq(aiReports.sessionId, sessionId),
        inArray(aiReports.status, ['queued', 'processing']),
      ),
      orderBy: desc(aiReports.createdAt),
    });
    if (open) return this.toAnswers(open);
    if ((await this.openJobsOfOrg(orgId)) >= MAX_OPEN_JOBS_PER_ORG) throw this.tooMany();
    const [row] = await this.db
      .insert(aiReports)
      .values({ organizationId: orgId, kind: 'answers', sessionId, locale, createdBy: userId })
      .returning();
    this.enqueue(row!.id);
    return this.toAnswers(row!);
  }

  /** Latest analysis of a session's answers, or null. */
  async latestAnswers(orgId: string, sessionId: string): Promise<AnswersAnalysis | null> {
    await this.sessions.assertSessionInOrg(sessionId, orgId);
    const row = await this.db.query.aiReports.findFirst({
      where: and(
        eq(aiReports.organizationId, orgId),
        eq(aiReports.kind, 'answers'),
        eq(aiReports.sessionId, sessionId),
      ),
      orderBy: desc(aiReports.createdAt),
    });
    return row ? this.toAnswers(row) : null;
  }

  // ── «ИИ-куратор» ────────────────────────────────────────────────────────

  async startCurator(
    orgId: string,
    userId: string,
    category: string,
    locale: AiReportLocale,
  ): Promise<CuratorReportRecord> {
    const categories = await this.curatorAgent.categories(orgId);
    if (!categories.some((c) => c.name === category)) throw new NotFoundException('category_not_found');
    const open = await this.db.query.aiReports.findFirst({
      where: and(
        eq(aiReports.organizationId, orgId),
        eq(aiReports.kind, 'curator'),
        eq(aiReports.category, category),
        inArray(aiReports.status, ['queued', 'processing']),
      ),
      orderBy: desc(aiReports.createdAt),
    });
    if (open) return this.toCurator(open);
    if ((await this.openJobsOfOrg(orgId)) >= MAX_OPEN_JOBS_PER_ORG) throw this.tooMany();
    const [row] = await this.db
      .insert(aiReports)
      .values({ organizationId: orgId, kind: 'curator', category, locale, createdBy: userId })
      .returning();
    this.enqueue(row!.id);
    return this.toCurator(row!);
  }

  /** Company tiles + the latest report of the chosen company. */
  async curatorOverview(orgId: string, category: string | undefined): Promise<CuratorReportsResponse> {
    const categories = await this.curatorAgent.categories(orgId);
    const last = await this.db
      .select({
        category: aiReports.category,
        at: sql<string>`max(${aiReports.createdAt})`,
      })
      .from(aiReports)
      .where(
        and(
          eq(aiReports.organizationId, orgId),
          eq(aiReports.kind, 'curator'),
          eq(aiReports.status, 'done'),
        ),
      )
      .groupBy(aiReports.category);
    const lastBy = new Map(last.map((l) => [l.category, l.at]));
    let report: CuratorReportRecord | null = null;
    if (category) {
      const row = await this.db.query.aiReports.findFirst({
        where: and(
          eq(aiReports.organizationId, orgId),
          eq(aiReports.kind, 'curator'),
          eq(aiReports.category, category),
        ),
        orderBy: desc(aiReports.createdAt),
      });
      report = row ? this.toCurator(row) : null;
    }
    return {
      categories: categories.map((c) => {
        const at = lastBy.get(c.name);
        return { ...c, lastReportAt: at ? new Date(at).toISOString() : null };
      }),
      report,
    };
  }

  // ── job queue ────────────────────────────────────────────────────────────

  private enqueue(id: string): void {
    this.queue.push(id);
    void this.pump();
  }

  private async pump(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      for (let id = this.queue.shift(); id; id = this.queue.shift()) {
        await this.runJob(id).catch((err) =>
          this.logger.error(`AI report ${id} crashed: ${err instanceof Error ? err.stack : String(err)}`),
        );
      }
    } finally {
      this.running = false;
    }
  }

  private async setProgress(id: string, progress: number, stage: AiReportStage): Promise<void> {
    await this.db
      .update(aiReports)
      .set({ progress: Math.round(progress), stage, status: 'processing' })
      .where(eq(aiReports.id, id));
  }

  private async fail(id: string, error: string): Promise<void> {
    this.logger.warn(`AI report ${id} failed: ${error}`);
    await this.db
      .update(aiReports)
      .set({ status: 'failed', error: error.slice(0, 300), finishedAt: new Date() })
      .where(eq(aiReports.id, id));
  }

  private async runJob(id: string): Promise<void> {
    const row = await this.db.query.aiReports.findFirst({ where: eq(aiReports.id, id) });
    if (!row) return;
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), JOB_TIMEOUT_MS);
    const ctx: AgentContext = {
      orgId: row.organizationId,
      locale: row.locale as AiReportLocale,
      signal: abort.signal,
      logger: this.logger,
      progress: (p, stage) => this.setProgress(id, p, stage),
    };
    try {
      const outcome =
        row.kind === 'answers' && row.sessionId
          ? await this.answersAgent.run(row.sessionId, ctx)
          : row.kind === 'curator' && row.category
            ? await this.curatorAgent.run(row.category, ctx)
            : ({ ok: false, error: 'bad_request' } as const);
      if (!outcome.ok) return await this.fail(id, outcome.error);
      await this.db
        .update(aiReports)
        .set({
          status: 'done',
          progress: 100,
          stage: 'done',
          result: { report: outcome.report, stats: outcome.stats },
          error: null,
          finishedAt: new Date(),
        })
        .where(eq(aiReports.id, id));
    } catch (err) {
      this.logger.error(`AI report ${id}: ${err instanceof Error ? err.message : String(err)}`);
      await this.fail(id, failureReason(err, abort.signal.aborted));
    } finally {
      clearTimeout(timer);
    }
  }
}
