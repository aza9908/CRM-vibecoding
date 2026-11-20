import { z } from 'zod';

/**
 * Two AI agents built on the same background-job pattern as «ИИ-разбор
 * урока» (see `analysis.dto.ts`), stored in one table `ai_reports`:
 *
 *  - «ИИ-анализ ответов» (`kind = 'answers'`) — per live session: how the
 *    group answered the workbook, per-question insights, who needs help,
 *    personal feedback for every student, tips for the next lesson.
 *  - «ИИ-куратор» (`kind = 'curator'`) — per company (lesson category):
 *    program progress for the client's HR / L&D, learners at risk with a next
 *    step, top performers, actions for the trainer and a ready HR message.
 *
 * Students are sent to the model anonymised («Участник 3» / «Ученик 3»); the
 * API maps the labels back to names only in our own database. The schemas
 * below are the contract for the model's JSON (validated by the API) and for
 * the web UI. `name` / `participantId` are filled in by the API after
 * validation — anything the model puts there is discarded.
 */

export const AI_REPORT_KINDS = ['answers', 'curator'] as const;
export type AiReportKind = (typeof AI_REPORT_KINDS)[number];

export const AI_REPORT_STATUSES = ['queued', 'processing', 'done', 'failed'] as const;
export type AiReportStatus = (typeof AI_REPORT_STATUSES)[number];

/** What the job is doing right now (drives the progress label in the UI). */
export const AI_REPORT_STAGES = [
  'queued',
  'collecting',
  'questions',
  'students',
  'report',
  'done',
] as const;
export type AiReportStage = (typeof AI_REPORT_STAGES)[number];

/** Languages a report can be written in (the teacher's UI locale). */
export const AI_REPORT_LOCALES = ['ru', 'uz', 'kk', 'en'] as const;
export type AiReportLocale = (typeof AI_REPORT_LOCALES)[number];

const text = (max: number) => z.string().trim().min(1).max(max);
/** An anonymous label as the model sees it: «Участник 3» / «Ученик 3». */
const label = z.string().trim().min(1).max(40);
/** Who a label stands for — added by the API, never by the model. */
const person = {
  name: z.string().trim().max(200).optional(),
  participantId: z.string().uuid().optional(),
};

// ── «ИИ-анализ ответов» ──────────────────────────────────────────────────────

/** Insights about one workbook question (map step, one per question). */
export const answersQuestionInsightSchema = z.object({
  /** `Q3` — the question's reference in the prompt. */
  ref: z.string().trim().regex(/^Q\d{1,3}$/),
  /** Short title of the question (from its text). */
  title: text(200),
  /** How many answered / how many students (set by the API, not the model). */
  answered: z.number().int().min(0).optional(),
  total: z.number().int().min(0).optional(),
  /** What most of the group understood / did well. */
  understood: z.string().trim().max(600).default(''),
  /** Common mistakes and misconceptions. */
  mistakes: z.array(text(300)).max(5).default([]),
  /** Strongest answers, quoted briefly. */
  bestAnswers: z
    .array(z.object({ participant: label, quote: text(300), ...person }))
    .max(3)
    .default([]),
});
export type AnswersQuestionInsight = z.infer<typeof answersQuestionInsightSchema>;

/** Map step answer: insights for one group of questions. */
export const answersQuestionsChunkSchema = z.object({
  questions: z.array(answersQuestionInsightSchema).max(40),
});

export const answersFeedbackItemSchema = z.object({
  participant: label,
  /** 1–3 kind, specific sentences addressed to the student. */
  text: text(700),
  /** The model's flag that this student needs the teacher's attention. */
  needsHelp: z.boolean().optional(),
  ...person,
});
export type AnswersFeedbackItem = z.infer<typeof answersFeedbackItemSchema>;

/** Students step answer: personal feedback for one batch of students. */
export const answersFeedbackBatchSchema = z.object({
  feedback: z.array(answersFeedbackItemSchema).max(60),
});

export const answersNeedHelpItemSchema = z.object({
  participant: label,
  reason: text(400),
  ...person,
});

/** Reduce step answer: the group-level part of the report. */
export const answersSummarySchema = z.object({
  /** 2–5 sentences: how the group did overall. */
  summary: text(2000),
  needHelp: z.array(answersNeedHelpItemSchema).max(60),
  /** Suggestions for the teacher for the next lesson. */
  teacherTips: z.array(text(400)).max(6),
});

/** The full «ИИ-анализ ответов» report as stored and shown. */
export const answersReportSchema = answersSummarySchema.extend({
  questions: z.array(answersQuestionInsightSchema).max(120),
  feedback: z.array(answersFeedbackItemSchema).max(1000),
});
export type AnswersReport = z.infer<typeof answersReportSchema>;

/** Numbers the API counted itself (not from the model). */
export interface AnswersReportStats {
  participants: number;
  /** Students who answered at least one question. */
  active: number;
  questions: number;
  answers: number;
  /** How many model calls the job made (map + students + reduce). */
  calls: number;
  /** Answers left out of the per-question material to cap its size. */
  sampled: boolean;
}

// ── «ИИ-куратор» ────────────────────────────────────────────────────────────

export const CURATOR_TRENDS = ['up', 'flat', 'down', 'unknown'] as const;

export const curatorLearnerStepSchema = z.object({
  learner: label,
  step: text(400),
  ...person,
});

/** Batch answer: next-step recommendations for a group of learners. */
export const curatorStepsBatchSchema = z.object({
  learnerSteps: z.array(curatorLearnerStepSchema).max(80),
});

/** Main curator answer (everything except the per-learner steps of big groups). */
export const curatorMainSchema = z.object({
  overview: z.object({
    /** 2–4 sentences for the client company (HR / L&D style). */
    summary: text(1500),
    attendance: text(500),
    completion: text(500),
    engagement: text(500),
    trend: z.enum(CURATOR_TRENDS).catch('unknown'),
    trendNote: z.string().trim().max(500).default(''),
  }),
  atRisk: z
    .array(z.object({ learner: label, reason: text(400), nextStep: text(400), ...person }))
    .max(40),
  topPerformers: z.array(z.object({ learner: label, why: text(300), ...person })).max(10),
  /** What to repeat, whom to call — concrete actions for the trainer. */
  trainerActions: z.array(text(400)).max(8),
  /** Short ready-to-send message to the company's HR (Russian by default). */
  hrMessage: text(3000),
  learnerSteps: z.array(curatorLearnerStepSchema).max(80).default([]),
});

export const curatorReportSchema = curatorMainSchema.extend({
  learnerSteps: z.array(curatorLearnerStepSchema).max(1000),
});
export type CuratorReport = z.infer<typeof curatorReportSchema>;

/** Program numbers the API counted itself (from the rating and sessions). */
export interface CuratorReportStats {
  learners: number;
  sessions: number;
  lessons: number;
  /** Learners active in the last 30 days. */
  active30d: number;
  /** Average share of the held lessons a learner attended, 0–100. */
  attendanceRate: number;
  /** Required checkpoints of the held lessons. */
  requiredTotal: number;
  /** Average share of required checkpoints done, 0–100 (null: none exist). */
  requiredRate: number | null;
  avgPoints: number;
  firstLessonAt: string | null;
  lastLessonAt: string | null;
  /** Answers- and lesson-analyses whose summaries were used. */
  analysesUsed: number;
  calls: number;
}

// ── requests / responses ────────────────────────────────────────────────────

/** Body of `POST /sessions/:id/answers-analysis`. */
export const startAnswersAnalysisSchema = z.object({
  locale: z.enum(AI_REPORT_LOCALES).catch('ru'),
});
export type StartAnswersAnalysisDto = z.infer<typeof startAnswersAnalysisSchema>;

/** Body of `POST /curator/reports`. */
export const startCuratorReportSchema = z.object({
  category: z.string().trim().min(1).max(200),
  locale: z.enum(AI_REPORT_LOCALES).catch('ru'),
});
export type StartCuratorReportDto = z.infer<typeof startCuratorReportSchema>;

/** Query of `GET /curator/reports`. */
export const curatorReportQuerySchema = z.object({
  /** Missing/empty: only the company tiles, no report. */
  category: z
    .string()
    .trim()
    .max(200)
    .optional()
    .transform((v) => (v ? v : undefined)),
});
export type CuratorReportQuery = z.infer<typeof curatorReportQuerySchema>;

interface AiReportBase {
  id: string;
  status: AiReportStatus;
  /** 0–100. */
  progress: number;
  stage: AiReportStage;
  locale: AiReportLocale;
  /** Machine-readable failure reason (e.g. `no_answers`, `timeout`). */
  error: string | null;
  createdAt: string;
  finishedAt: string | null;
}

export interface AnswersAnalysis extends AiReportBase {
  kind: 'answers';
  sessionId: string;
  report: AnswersReport | null;
  stats: AnswersReportStats | null;
}

export interface CuratorReportRecord extends AiReportBase {
  kind: 'curator';
  category: string;
  report: CuratorReport | null;
  stats: CuratorReportStats | null;
}

/** `GET /curator/reports` — the company tiles and the latest report. */
export interface CuratorReportsResponse {
  /** Companies (lesson categories) with real classes in the organization. */
  categories: { name: string; learners: number; lastReportAt: string | null }[];
  report: CuratorReportRecord | null;
}
