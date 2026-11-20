import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, inArray, isNull, notIlike, sql } from 'drizzle-orm';
import {
  curatorMainSchema,
  curatorReportSchema,
  curatorStepsBatchSchema,
  type AnswersReport,
  type CuratorReport,
  type CuratorReportStats,
  type LessonAnalysisReport,
  type StudentRatingRow,
} from '@lms/shared';
import { DRIZZLE, type Db } from '../db/db.module';
import {
  aiReports,
  lessonAnalyses,
  lessonBlocks,
  lessons,
  liveSessions,
  participants,
  responses,
} from '../db/schema';
import { LLM_PROVIDER, type LlmProvider } from '../ai/providers/llm-provider.interface';
import { RatingService } from '../rating/rating.service';
import {
  labelResolver,
  type AgentContext,
  type AgentOutcome,
  type LabelTarget,
} from './agent-context';
import { askJson, cut, objects, strings } from './llm-json';
import { curatorReportMessages, curatorStepsMessages, learnerLabel } from './ai-reports.prompts';

const DAY_MS = 24 * 60 * 60 * 1000;
/** Learners the main call writes steps for itself; bigger groups go in batches. */
const STEPS_INLINE_MAX = 40;
const STEPS_BATCH = 40;
/** Learner rows the main call sees (top + most at risk) for a big company. */
const MAIN_TABLE_MAX = 80;
const ANALYSES_MAX = 8;

type Outcome = AgentOutcome<CuratorReport, CuratorReportStats>;

interface Learner {
  label: string;
  row: StudentRatingRow;
  /** Times an «ИИ-анализ ответов» listed this learner as needing help. */
  flagged: number;
  daysIdle: number | null;
  /** Share of held lessons attended, 0–1. */
  attendance: number;
}

const ymd = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10) : '—');
const oneLine = (s: string, max: number) => {
  const t = s.replace(/\s+/g, ' ').trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
};
const normName = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ');

/**
 * «ИИ-куратор»: the progress of one company's program (lesson category) →
 * an HR / L&D overview, learners at risk with a next step, top performers,
 * actions for the trainer, a ready HR message and a next step per learner.
 *
 * Learners come from the rating module (`RatingService.forStaff`), so «one
 * student across sessions» follows exactly the rating's identity rules
 * (account ↔ phone ↔ device). They go to the model as «Ученик N»; summaries
 * of the latest answers- and lesson-analyses add what happened in class.
 */
@Injectable()
export class CuratorAgent {
  constructor(
    @Inject(DRIZZLE) private readonly db: Db,
    @Inject(LLM_PROVIDER) private readonly llm: LlmProvider,
    private readonly rating: RatingService,
  ) {}

  /** Companies (lesson categories) with real classes, with learner counts. */
  async categories(orgId: string): Promise<{ name: string; learners: number }[]> {
    const r = await this.rating.forStaff(orgId, undefined, 'all');
    return r.categories.map((c) => ({ name: c.name, learners: c.students }));
  }

  async run(category: string, ctx: AgentContext): Promise<Outcome> {
    let calls = 0;
    await ctx.progress(5, 'collecting');

    // 1. Learners, as the rating counts them (org-scoped inside forStaff).
    const rating = await this.rating.forStaff(ctx.orgId, category, 'all');
    if (!rating.categories.some((c) => c.name === category)) {
      return { ok: false, error: 'category_not_found' };
    }
    if (rating.rows.length === 0) return { ok: false, error: 'no_learners' };

    // 2. Sessions held for this company, with attendance per session.
    const sessions = await this.db
      .select({
        id: liveSessions.id,
        lessonId: liveSessions.lessonId,
        title: lessons.title,
        startTime: liveSessions.startTime,
        createdAt: liveSessions.createdAt,
      })
      .from(liveSessions)
      .innerJoin(lessons, eq(lessons.id, liveSessions.lessonId))
      .where(
        and(
          eq(liveSessions.organizationId, ctx.orgId),
          eq(lessons.organizationId, ctx.orgId),
          sql`trim(${lessons.category}) = ${category}`,
          notIlike(lessons.title, '%(авто)%'),
        ),
      );
    sessions.sort(
      (a, b) =>
        (a.startTime ?? a.createdAt ?? new Date(0)).getTime() -
        (b.startTime ?? b.createdAt ?? new Date(0)).getTime(),
    );
    const sessionIds = sessions.map((s) => s.id);
    const heldLessonIds = [...new Set(sessions.map((s) => s.lessonId).filter((v): v is string => !!v))];

    const joined = new Map<string, number>();
    const answeredBy = new Map<string, number>();
    if (sessionIds.length) {
      const j = await this.db
        .select({ sessionId: participants.sessionId, n: sql<number>`count(*)::int` })
        .from(participants)
        .where(and(inArray(participants.sessionId, sessionIds), isNull(participants.removedAt)))
        .groupBy(participants.sessionId);
      for (const r of j) if (r.sessionId) joined.set(r.sessionId, r.n);
      const a = await this.db
        .select({
          sessionId: participants.sessionId,
          n: sql<number>`count(distinct ${participants.id})::int`,
        })
        .from(responses)
        .innerJoin(participants, eq(participants.id, responses.participantId))
        .where(and(inArray(participants.sessionId, sessionIds), isNull(participants.removedAt)))
        .groupBy(participants.sessionId);
      for (const r of a) if (r.sessionId) answeredBy.set(r.sessionId, r.n);
    }

    // 3. Required checkpoints of the held lessons; the schedule ahead.
    let requiredTotal = 0;
    if (heldLessonIds.length) {
      const blocks = await this.db
        .select({ options: lessonBlocks.options })
        .from(lessonBlocks)
        .where(inArray(lessonBlocks.lessonId, heldLessonIds));
      requiredTotal = blocks.filter(
        (b) => !!b.options && typeof b.options === 'object' && (b.options as Record<string, unknown>).required === true,
      ).length;
    }
    const upcoming = await this.db
      .select({ title: lessons.title, scheduledAt: lessons.scheduledAt })
      .from(lessons)
      .where(
        and(
          eq(lessons.organizationId, ctx.orgId),
          sql`trim(${lessons.category}) = ${category}`,
          eq(lessons.archived, false),
          sql`${lessons.scheduledAt} > now()`,
        ),
      )
      .orderBy(lessons.scheduledAt)
      .limit(10);
    await ctx.progress(15, 'collecting');

    // 4. What the other agents said about these sessions (summaries only).
    const titleOf = new Map(sessions.map((s) => [s.id, s.title]));
    const dateOf = new Map(sessions.map((s) => [s.id, s.startTime ?? s.createdAt]));
    const flaggedNames = new Map<string, number>();
    const analysisLines: string[] = [];
    let analysesUsed = 0;
    if (sessionIds.length) {
      const answersRows = await this.db
        .select({ sessionId: aiReports.sessionId, result: aiReports.result })
        .from(aiReports)
        .where(
          and(
            eq(aiReports.organizationId, ctx.orgId),
            eq(aiReports.kind, 'answers'),
            eq(aiReports.status, 'done'),
            inArray(aiReports.sessionId, sessionIds),
          ),
        )
        .orderBy(desc(aiReports.createdAt))
        .limit(60);
      const seen = new Set<string>();
      for (const r of answersRows) {
        if (!r.sessionId || seen.has(r.sessionId)) continue;
        seen.add(r.sessionId);
        const report = (r.result as { report?: AnswersReport } | null)?.report;
        if (!report) continue;
        for (const n of report.needHelp ?? []) {
          if (n.name) flaggedNames.set(normName(n.name), (flaggedNames.get(normName(n.name)) ?? 0) + 1);
        }
        if (seen.size > ANALYSES_MAX) continue;
        analysesUsed++;
        analysisLines.push(
          `- ${ymd(dateOf.get(r.sessionId))} «${oneLine(titleOf.get(r.sessionId) ?? '', 80)}» (answers analysis): ${oneLine(report.summary, 500)}` +
            (report.teacherTips?.length ? ` Tips: ${report.teacherTips.slice(0, 2).map((t) => oneLine(t, 160)).join('; ')}` : '') +
            ` Needed help: ${report.needHelp?.length ?? 0}.`,
        );
      }
      const lessonRows = await this.db
        .select({ sessionId: lessonAnalyses.sessionId, report: lessonAnalyses.report })
        .from(lessonAnalyses)
        .where(
          and(
            eq(lessonAnalyses.organizationId, ctx.orgId),
            eq(lessonAnalyses.status, 'done'),
            inArray(lessonAnalyses.sessionId, sessionIds),
          ),
        )
        .orderBy(desc(lessonAnalyses.createdAt))
        .limit(30);
      const seenLesson = new Set<string>();
      for (const r of lessonRows) {
        if (seenLesson.has(r.sessionId) || seenLesson.size >= ANALYSES_MAX) continue;
        seenLesson.add(r.sessionId);
        const report = r.report as LessonAnalysisReport | null;
        if (!report?.summary) continue;
        analysesUsed++;
        analysisLines.push(
          `- ${ymd(dateOf.get(r.sessionId))} «${oneLine(titleOf.get(r.sessionId) ?? '', 80)}» (lesson recording review, score ${report.score?.overall ?? '—'}/10): ${oneLine(report.summary, 500)}` +
            (report.recommendations?.length ? ` Recommended: ${report.recommendations.slice(0, 2).map((t) => oneLine(t, 160)).join('; ')}` : ''),
        );
      }
    }

    // 5. Learners, anonymised in rating order.
    const now = Date.now();
    const held = Math.max(1, heldLessonIds.length);
    const learners: Learner[] = rating.rows.map((row, i) => ({
      label: learnerLabel(i + 1),
      row,
      flagged: flaggedNames.get(normName(row.name)) ?? 0,
      daysIdle: row.lastActivity ? Math.floor((now - new Date(row.lastActivity).getTime()) / DAY_MS) : null,
      attendance: Math.min(1, row.lessons / held),
    }));
    const targets = new Map<string, LabelTarget>(learners.map((l) => [l.label, { name: l.row.name }]));
    const resolve = labelResolver(targets, 'Ученик');
    const line = (l: Learner) =>
      `${l.label}: points ${l.row.points} (rank ${l.row.rank}); lessons ${l.row.lessons} of ${heldLessonIds.length}; answers ${l.row.answered}; required ${l.row.requiredDone}${requiredTotal ? ` of ${requiredTotal}` : ''}` +
      (l.row.projectStageTitle ? `; project stage «${oneLine(l.row.projectStageTitle, 40)}»` : '') +
      `; last active ${l.daysIdle == null ? 'unknown' : `${l.daysIdle} days ago`}` +
      (l.flagged ? `; flagged "needs help" by answers analyses ×${l.flagged}` : '');

    const stats: CuratorReportStats = {
      learners: learners.length,
      sessions: sessions.length,
      lessons: heldLessonIds.length,
      active30d: learners.filter((l) => l.daysIdle != null && l.daysIdle <= 30).length,
      attendanceRate: Math.round((100 * learners.reduce((s, l) => s + l.attendance, 0)) / learners.length),
      requiredTotal,
      requiredRate: requiredTotal
        ? Math.round(
            (100 * learners.reduce((s, l) => s + Math.min(1, l.row.requiredDone / requiredTotal), 0)) /
              learners.length,
          )
        : null,
      avgPoints: Math.round(learners.reduce((s, l) => s + l.row.points, 0) / learners.length),
      firstLessonAt: sessions[0] ? (sessions[0].startTime ?? sessions[0].createdAt)?.toISOString() ?? null : null,
      lastLessonAt: sessions.at(-1) ? (sessions.at(-1)!.startTime ?? sessions.at(-1)!.createdAt)?.toISOString() ?? null : null,
      analysesUsed,
      calls: 0,
    };

    // Big company: the main call sees the top 10 and the most at-risk rows.
    let table = learners;
    let tableNote = '';
    if (learners.length > MAIN_TABLE_MAX) {
      // Lower = more at risk: missed lessons, skipped checkpoints, silence, idle days, flags.
      const risk = (l: Learner) =>
        l.attendance +
        (requiredTotal ? Math.min(1, l.row.requiredDone / requiredTotal) : 0) +
        (l.row.answered > 0 ? 0.5 : 0) -
        Math.min(2, (l.daysIdle ?? 60) / 30) -
        0.5 * l.flagged;
      const top = learners.slice(0, 10);
      const rest = learners
        .slice(10)
        .sort((a, b) => risk(a) - risk(b))
        .slice(0, MAIN_TABLE_MAX - 10);
      table = [...top, ...rest];
      tableNote = `(showing the top 10 and the ${rest.length} learners most at risk of ${learners.length}; the others have typical numbers)`;
    }
    const withSteps = learners.length <= STEPS_INLINE_MAX;
    const programText = [
      'PROGRAM NUMBERS:',
      `- learners: ${stats.learners}; active in the last 30 days: ${stats.active30d}`,
      `- lessons held: ${stats.lessons} (${stats.sessions} live sessions), from ${ymd(sessions[0]?.startTime ?? sessions[0]?.createdAt)} to ${ymd(sessions.at(-1)?.startTime ?? sessions.at(-1)?.createdAt)}`,
      `- average attendance: ${stats.attendanceRate}% of held lessons`,
      stats.requiredRate != null
        ? `- required checkpoints: ${requiredTotal}; average done: ${stats.requiredRate}%`
        : '- required checkpoints: none in these lessons',
      `- average points: ${stats.avgPoints}`,
    ].join('\n');
    const lessonsText = sessions
      .slice(-30)
      .map(
        (s) =>
          `- ${ymd(s.startTime ?? s.createdAt)} «${oneLine(s.title, 90)}»: joined ${joined.get(s.id) ?? 0}, answered the workbook ${answeredBy.get(s.id) ?? 0}`,
      )
      .join('\n');
    const material = [
      programText,
      '',
      'LESSONS HELD (oldest first):',
      lessonsText || '(none)',
      '',
      'UPCOMING LESSONS (schedule):',
      upcoming.map((u) => `- ${ymd(u.scheduledAt)} «${oneLine(u.title, 90)}»`).join('\n') || '(none scheduled)',
      '',
      'SUMMARIES OF AI ANALYSES OF RECENT LESSONS:',
      analysisLines.join('\n') || '(none)',
      '',
      `LEARNERS ${tableNote}:`,
      table.map(line).join('\n'),
    ].join('\n');
    await ctx.progress(25, 'report');

    // 6. The report itself.
    calls++;
    const main = await askJson({
      llm: this.llm,
      messages: curatorReportMessages({ locale: ctx.locale, company: category, withSteps, material }),
      schema: curatorMainSchema,
      tidy: (x) => this.tidyMain(x),
      maxTokens: withSteps ? 4_000 : 3_000,
      temperature: 0.2,
      signal: ctx.signal,
      logger: ctx.logger,
      what: 'curator report',
    });
    if (!main) return { ok: false, error: 'bad_report' };

    // 7. Per-learner steps in batches for a big company.
    const steps = new Map<string, string>();
    const take = (list: { learner: string; step: string }[], allowed?: Set<string>) => {
      for (const s of list) {
        const who = resolve(s.learner);
        if (!who || steps.has(who.label) || (allowed && !allowed.has(who.label))) continue;
        steps.set(who.label, s.step);
      }
    };
    if (withSteps) {
      take(main.learnerSteps);
    } else {
      const batches: Learner[][] = [];
      for (let i = 0; i < learners.length; i += STEPS_BATCH) batches.push(learners.slice(i, i + STEPS_BATCH));
      for (let b = 0; b < batches.length; b++) {
        const group = batches[b]!;
        calls++;
        const parsed = await askJson({
          llm: this.llm,
          messages: curatorStepsMessages({
            locale: ctx.locale,
            company: category,
            context: programText,
            learners: group.map(line).join('\n'),
          }),
          schema: curatorStepsBatchSchema,
          tidy: (x) => this.tidySteps(x),
          maxTokens: Math.min(3_500, 200 + group.length * 70),
          temperature: 0.2,
          signal: ctx.signal,
          logger: ctx.logger,
          what: `curator steps batch ${b + 1}`,
        });
        take(parsed?.learnerSteps ?? [], new Set(group.map((l) => l.label)));
        await ctx.progress(55 + (40 * (b + 1)) / batches.length, 'students');
      }
    }

    const mapPeople = <T extends { learner: string }>(list: T[]) => {
      const seen = new Set<string>();
      return list.flatMap((x) => {
        const who = resolve(x.learner);
        if (!who || seen.has(who.label)) return [];
        seen.add(who.label);
        return [{ ...x, learner: who.label, name: who.target.name }];
      });
    };
    const report = curatorReportSchema.safeParse({
      ...main,
      atRisk: mapPeople(main.atRisk),
      topPerformers: mapPeople(main.topPerformers),
      learnerSteps: learners
        .filter((l) => steps.has(l.label))
        .map((l) => ({ learner: l.label, step: steps.get(l.label)!, name: l.row.name })),
    });
    if (!report.success) {
      ctx.logger.warn(`curator report invalid: ${report.error.issues[0]?.message ?? ''}`);
      return { ok: false, error: 'bad_report' };
    }
    return { ok: true, report: report.data, stats: { ...stats, calls } };
  }

  // ── tidy ─────────────────────────────────────────────────────────────────

  private tidyMain(input: unknown): unknown {
    if (!input || typeof input !== 'object') return input;
    const r = input as Record<string, unknown>;
    const o = (r.overview && typeof r.overview === 'object' ? r.overview : {}) as Record<string, unknown>;
    return {
      overview: {
        summary: cut(o.summary, 1500),
        attendance: cut(o.attendance, 500),
        completion: cut(o.completion, 500),
        engagement: cut(o.engagement, 500),
        trend: typeof o.trend === 'string' ? o.trend.trim().toLowerCase() : o.trend,
        trendNote: typeof o.trendNote === 'string' ? o.trendNote.trim().slice(0, 500) : '',
      },
      atRisk: objects(r.atRisk, 40)
        .filter((x) => typeof x.reason === 'string' && typeof x.nextStep === 'string')
        .map((x) => ({ learner: cut(x.learner, 40), reason: cut(x.reason, 400), nextStep: cut(x.nextStep, 400) })),
      topPerformers: objects(r.topPerformers, 10)
        .filter((x) => typeof x.why === 'string')
        .map((x) => ({ learner: cut(x.learner, 40), why: cut(x.why, 300) })),
      trainerActions: strings(r.trainerActions, 8, 400),
      hrMessage: cut(r.hrMessage, 3000),
      learnerSteps: (this.tidySteps(r) as { learnerSteps: unknown[] }).learnerSteps,
    };
  }

  private tidySteps(input: unknown): unknown {
    if (!input || typeof input !== 'object') return input;
    const r = input as Record<string, unknown>;
    return {
      learnerSteps: objects(r.learnerSteps, 80)
        .filter((x) => typeof x.step === 'string' && x.step.trim())
        .map((x) => ({ learner: cut(x.learner, 40), step: cut(x.step, 400) })),
    };
  }
}
