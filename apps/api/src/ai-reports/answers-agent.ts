import { Inject, Injectable } from '@nestjs/common';
import { and, asc, eq, inArray, isNull } from 'drizzle-orm';
import {
  answersFeedbackBatchSchema,
  answersQuestionsChunkSchema,
  answersReportSchema,
  answersSummarySchema,
  type AnswersFeedbackItem,
  type AnswersQuestionInsight,
  type AnswersReport,
  type AnswersReportStats,
} from '@lms/shared';
import { DRIZZLE, type Db } from '../db/db.module';
import { lessonBlocks, lessons, liveSessions, participants, responses, users } from '../db/schema';
import { LLM_PROVIDER, type LlmProvider } from '../ai/providers/llm-provider.interface';
import {
  labelResolver,
  plainText,
  type AgentContext,
  type AgentOutcome,
  type LabelTarget,
} from './agent-context';
import { askJson, cut, objects, strings } from './llm-json';
import {
  answersFeedbackMessages,
  answersQuestionsMessages,
  answersSummaryMessages,
  participantLabel,
} from './ai-reports.prompts';

/** Blocks a student answers (content blocks, buttons and boards are not). */
const TASK_TYPES = new Set(['input_text', 'input_select', 'input_rating', 'input_file', 'test', 'checklist']);
const CHOICE_TYPES = new Set(['input_select', 'test']);

/** Size caps that keep every call well inside low tokens-per-minute limits. */
const QUESTION_CHUNK_CHARS = 10_000;
const QUESTION_ANSWERS_CHARS = 6_000;
const ANSWER_CHARS = 300;
const STUDENT_BATCH_CHARS = 9_000;
const STUDENT_BATCH_MAX = 20;
const STUDENT_ANSWER_CHARS = 220;
const SUMMARY_TABLE_ROWS = 150;
const MAX_QUESTIONS = 120;

interface Question {
  ref: string;
  blockId: string;
  type: string;
  header: string;
  choices: string[];
  correct: Set<string>;
  items: string[];
}

interface Answer {
  text: string;
  /** null when the question has no known correct answer. */
  correct: boolean | null;
  answered: boolean;
  /** Checklist: items ticked. */
  ticked?: number;
}

interface Student {
  label: string;
  target: LabelTarget;
  /** blockId → answer. */
  answers: Map<string, Answer>;
}

type Outcome = AgentOutcome<AnswersReport, AnswersReportStats>;

/** Labels/values of a select/test block's options (several stored shapes). */
function readChoices(options: unknown): string[] {
  const list = (v: unknown): string[] =>
    (Array.isArray(v) ? v : [])
      .map((o) => {
        if (typeof o === 'string') return o;
        if (o && typeof o === 'object') {
          const r = o as Record<string, unknown>;
          const s = r.label ?? r.text ?? r.value;
          return typeof s === 'string' ? s : '';
        }
        return o == null ? '' : String(o);
      })
      .filter((s) => s.trim().length > 0);
  if (Array.isArray(options)) return list(options);
  if (options && typeof options === 'object') {
    const r = options as Record<string, unknown>;
    return list(r.options ?? r.choices ?? r.items);
  }
  return [];
}

/** Correct values: `{ choices, correctIndex }` or legacy `{ correct }`. */
function readCorrect(options: unknown): Set<string> {
  const out = new Set<string>();
  if (!options || typeof options !== 'object' || Array.isArray(options)) return out;
  const r = options as Record<string, unknown>;
  if (typeof r.correctIndex === 'number') {
    const choices = readChoices(options);
    const c = choices[r.correctIndex];
    if (c) out.add(c.trim());
    return out;
  }
  const raw = r.correct;
  for (const v of Array.isArray(raw) ? raw : raw != null ? [raw] : []) out.add(String(v).trim());
  return out;
}

function readItems(options: unknown): string[] {
  if (!options || typeof options !== 'object') return [];
  const items = (options as Record<string, unknown>).items;
  return (Array.isArray(items) ? items : [])
    .map((v) =>
      typeof v === 'string'
        ? v
        : v && typeof v === 'object' && typeof (v as Record<string, unknown>).text === 'string'
          ? ((v as Record<string, unknown>).text as string)
          : '',
    )
    .map((s) => s.trim());
}

function checklistIndices(answer: string | null): number[] {
  if (!answer) return [];
  try {
    const parsed: unknown = JSON.parse(answer);
    return Array.isArray(parsed) ? parsed.filter((n): n is number => typeof n === 'number') : [];
  } catch {
    return [];
  }
}

function digits(phone: string | null): string | null {
  const d = (phone ?? '').replace(/\D+/g, '');
  return d.length >= 6 ? d : null;
}

const oneLine = (s: string, max: number) => {
  const t = s.replace(/\s+/g, ' ').trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
};

/**
 * «ИИ-анализ ответов»: the workbook answers of one live session → insights per
 * question, personal feedback per student, group summary and teacher tips.
 *
 * Big sessions (50+ students × many blocks) are handled map-reduce style,
 * like long transcripts in the lesson analysis:
 *  1. questions — groups of questions (≤10k chars each) → insights per
 *     question; free-text answers are sampled evenly when one question has
 *     more than ~6k chars of them, choice answers go in as a distribution;
 *  2. students — batches of ≤20 students (≤9k chars) → 1–3 sentences each;
 *  3. report — the insights + a compact per-student table → summary, who
 *     needs help, tips.
 * Every call has a token cap; nothing grows with the class size in one call.
 */
@Injectable()
export class AnswersAgent {
  constructor(
    @Inject(DRIZZLE) private readonly db: Db,
    @Inject(LLM_PROVIDER) private readonly llm: LlmProvider,
  ) {}

  async run(sessionId: string, ctx: AgentContext): Promise<Outcome> {
    let calls = 0;
    await ctx.progress(5, 'collecting');

    // 1. The session (scoped again: the job never trusts its row alone).
    const [session] = await this.db
      .select({ lessonId: liveSessions.lessonId, title: lessons.title })
      .from(liveSessions)
      .leftJoin(lessons, eq(lessons.id, liveSessions.lessonId))
      .where(and(eq(liveSessions.id, sessionId), eq(liveSessions.organizationId, ctx.orgId)))
      .limit(1);
    if (!session) return { ok: false, error: 'session_not_found' };
    if (!session.lessonId) return { ok: false, error: 'no_questions' };
    const lessonTitle = session.title ?? 'Урок';

    const blockRows = await this.db
      .select({
        id: lessonBlocks.id,
        type: lessonBlocks.type,
        content: lessonBlocks.content,
        options: lessonBlocks.options,
      })
      .from(lessonBlocks)
      .where(eq(lessonBlocks.lessonId, session.lessonId))
      .orderBy(asc(lessonBlocks.orderIndex));
    const questions: Question[] = blockRows
      .filter((b) => TASK_TYPES.has(b.type))
      .slice(0, MAX_QUESTIONS)
      .map((b, i) => ({
        ref: `Q${i + 1}`,
        blockId: b.id,
        type: b.type,
        header: plainText(b.content, 400) || `(${b.type})`,
        choices: readChoices(b.options).map((c) => oneLine(c, 120)).slice(0, 12),
        correct: readCorrect(b.options),
        items: readItems(b.options),
      }));
    if (questions.length === 0) return { ok: false, error: 'no_questions' };
    const questionById = new Map(questions.map((q) => [q.blockId, q]));

    // 2. Students: removed participants and staff testing their lesson never count.
    const parts = await this.db
      .select({
        id: participants.id,
        userId: participants.userId,
        name: participants.name,
        phone: participants.phone,
        clientKey: participants.clientKey,
        createdAt: participants.createdAt,
      })
      .from(participants)
      .where(and(eq(participants.sessionId, sessionId), isNull(participants.removedAt)))
      .orderBy(asc(participants.createdAt));
    const userIds = [...new Set(parts.map((p) => p.userId).filter((v): v is string => !!v))];
    const staff = new Set<string>();
    if (userIds.length) {
      const rows = await this.db
        .select({ id: users.id, role: users.role })
        .from(users)
        .where(inArray(users.id, userIds));
      for (const u of rows) if (u.role !== 'student') staff.add(u.id);
    }
    const people = parts.filter((p) => !(p.userId && staff.has(p.userId)));
    if (people.length === 0) return { ok: false, error: 'no_answers' };

    // One person who re-joined (same account / phone / device) is one student —
    // the rating's identity rules, inside one session.
    const alias = new Map<string, string>();
    for (const p of people) {
      const phone = digits(p.phone);
      if (p.userId && phone) alias.set(`p:${phone}`, `u:${p.userId}`);
    }
    const keyOf = (p: (typeof people)[number]) => {
      const raw = p.userId
        ? `u:${p.userId}`
        : digits(p.phone)
          ? `p:${digits(p.phone)}`
          : p.clientKey
            ? `k:${p.clientKey}`
            : `r:${p.id}`;
      return alias.get(raw) ?? raw;
    };
    const students: Student[] = [];
    const studentByKey = new Map<string, Student>();
    const studentByParticipant = new Map<string, Student>();
    for (const p of people) {
      const key = keyOf(p);
      let s = studentByKey.get(key);
      if (!s) {
        s = {
          label: participantLabel(students.length + 1),
          target: { name: p.name.trim() || '—', participantId: p.id },
          answers: new Map(),
        };
        students.push(s);
        studentByKey.set(key, s);
      } else if (p.name.trim()) {
        s.target = { name: p.name.trim(), participantId: p.id };
      }
      studentByParticipant.set(p.id, s);
    }

    // 3. Answers (latest wins when one student answered from two rows).
    const resp = await this.db
      .select({
        participantId: responses.participantId,
        blockId: responses.blockId,
        answerText: responses.answerText,
        isCompleted: responses.isCompleted,
        updatedAt: responses.updatedAt,
      })
      .from(responses)
      .where(
        and(
          inArray(
            responses.participantId,
            people.map((p) => p.id),
          ),
          inArray(
            responses.blockId,
            questions.map((q) => q.blockId),
          ),
        ),
      )
      .orderBy(asc(responses.updatedAt));
    let answerCount = 0;
    for (const r of resp) {
      if (!r.participantId || !r.blockId) continue;
      const s = studentByParticipant.get(r.participantId);
      const q = questionById.get(r.blockId);
      if (!s || !q) continue;
      const a = this.readAnswer(q, r.answerText, !!r.isCompleted);
      if (!a.answered && s.answers.get(q.blockId)?.answered) continue;
      s.answers.set(q.blockId, a);
    }
    for (const s of students) for (const a of s.answers.values()) if (a.answered) answerCount++;
    const active = students.filter((s) => [...s.answers.values()].some((a) => a.answered));
    if (active.length === 0) return { ok: false, error: 'no_answers' };

    const targets = new Map(students.map((s) => [s.label, s.target]));
    const resolve = labelResolver(targets, 'Участник');
    await ctx.progress(12, 'questions');

    // 4. Map: insights per group of questions.
    let sampled = false;
    const blocksText = questions.map((q) => {
      const r = this.questionMaterial(q, students);
      if (r.sampled) sampled = true;
      return r.text;
    });
    const chunks: number[][] = [];
    let cur: number[] = [];
    let size = 0;
    blocksText.forEach((t, i) => {
      if (cur.length > 0 && size + t.length > QUESTION_CHUNK_CHARS) {
        chunks.push(cur);
        cur = [];
        size = 0;
      }
      cur.push(i);
      size += t.length + 2;
    });
    if (cur.length) chunks.push(cur);

    const insights = new Map<string, AnswersQuestionInsight>();
    let failedChunks = 0;
    for (let c = 0; c < chunks.length; c++) {
      const idx = chunks[c]!;
      const refs = new Set(idx.map((i) => questions[i]!.ref));
      calls++;
      const parsed = await askJson({
        llm: this.llm,
        messages: answersQuestionsMessages({
          locale: ctx.locale,
          lessonTitle,
          totalStudents: students.length,
          material: idx.map((i) => blocksText[i]).join('\n\n'),
        }),
        schema: answersQuestionsChunkSchema,
        tidy: (x) => this.tidyQuestions(x),
        maxTokens: 1_800,
        temperature: 0.2,
        signal: ctx.signal,
        logger: ctx.logger,
        what: `answers questions chunk ${c + 1}`,
      });
      if (!parsed) failedChunks++;
      for (const q of parsed?.questions ?? []) {
        if (!refs.has(q.ref) || insights.has(q.ref)) continue;
        insights.set(q.ref, {
          ...q,
          bestAnswers: q.bestAnswers.flatMap((b) => {
            const who = resolve(b.participant);
            return who
              ? [{ participant: who.label, quote: b.quote, name: who.target.name, participantId: who.target.participantId }]
              : [];
          }),
        });
      }
      await ctx.progress(12 + (38 * (c + 1)) / chunks.length, 'questions');
    }
    if (failedChunks === chunks.length) return { ok: false, error: 'bad_report' };
    const questionInsights: AnswersQuestionInsight[] = questions.map((q) => {
      const answered = students.filter((s) => s.answers.get(q.blockId)?.answered).length;
      const found = insights.get(q.ref);
      return {
        ref: q.ref,
        title: found?.title ?? oneLine(q.header, 200),
        understood: found?.understood ?? '',
        mistakes: found?.mistakes ?? [],
        bestAnswers: found?.bestAnswers ?? [],
        answered,
        total: students.length,
      };
    });
    const questionsDigest = questions
      .map((q) => `${q.ref}: ${oneLine(q.header, 160)}`)
      .join('\n');

    // 5. Students: personal feedback in batches.
    const batches: Student[][] = [];
    let batch: Student[] = [];
    let batchSize = 0;
    const studentText = new Map<Student, string>();
    for (const s of active) {
      const t = this.studentMaterial(s, questions);
      studentText.set(s, t);
      if (batch.length > 0 && (batchSize + t.length > STUDENT_BATCH_CHARS || batch.length >= STUDENT_BATCH_MAX)) {
        batches.push(batch);
        batch = [];
        batchSize = 0;
      }
      batch.push(s);
      batchSize += t.length + 2;
    }
    if (batch.length) batches.push(batch);
    await ctx.progress(50, 'students');

    const feedback = new Map<string, AnswersFeedbackItem>();
    for (let b = 0; b < batches.length; b++) {
      const group = batches[b]!;
      const labels = new Set(group.map((s) => s.label));
      calls++;
      const parsed = await askJson({
        llm: this.llm,
        messages: answersFeedbackMessages({
          locale: ctx.locale,
          lessonTitle,
          questionsDigest,
          material: group.map((s) => studentText.get(s)).join('\n\n'),
        }),
        schema: answersFeedbackBatchSchema,
        tidy: (x) => this.tidyFeedback(x),
        maxTokens: Math.min(3_500, 250 + group.length * 140),
        temperature: 0.3,
        signal: ctx.signal,
        logger: ctx.logger,
        what: `answers feedback batch ${b + 1}`,
      });
      for (const f of parsed?.feedback ?? []) {
        const who = resolve(f.participant);
        if (!who || !labels.has(who.label) || feedback.has(who.label)) continue;
        feedback.set(who.label, {
          participant: who.label,
          text: f.text,
          needsHelp: f.needsHelp ?? false,
          name: who.target.name,
          participantId: who.target.participantId,
        });
      }
      await ctx.progress(50 + (38 * (b + 1)) / batches.length, 'students');
    }
    await ctx.progress(88, 'report');

    // 6. Reduce: group summary, who needs help, tips.
    const tests = questions.filter((q) => q.correct.size > 0 && CHOICE_TYPES.has(q.type));
    const rows = students.map((s) => {
      const answered = [...s.answers.values()].filter((a) => a.answered).length;
      const right = tests.filter((q) => s.answers.get(q.blockId)?.correct === true).length;
      const flag =
        answered === 0 ? 'no answers' : feedback.get(s.label)?.needsHelp ? 'needs help' : '';
      return { s, answered, right, flag };
    });
    rows.sort((a, b) => a.answered - b.answered || a.right - b.right);
    const shown = rows.slice(0, SUMMARY_TABLE_ROWS);
    const studentsTable = [
      ...shown.map(
        (r) =>
          `${r.s.label}: ${r.answered}/${questions.length}` +
          (tests.length ? `; test ${r.right}/${tests.length}` : '') +
          (r.flag ? `; flag: ${r.flag}` : ''),
      ),
      ...(rows.length > shown.length
        ? [`…and ${rows.length - shown.length} more students who answered most tasks.`]
        : []),
    ].join('\n');
    const insightsDigest = questionInsights
      .map(
        (q) =>
          `${q.ref} «${q.title}» — answered ${q.answered}/${q.total}. ${q.understood}` +
          (q.mistakes.length ? ` Mistakes: ${q.mistakes.join('; ')}` : ''),
      )
      .join('\n')
      .slice(0, 14_000);
    calls++;
    const summary = await askJson({
      llm: this.llm,
      messages: answersSummaryMessages({
        locale: ctx.locale,
        lessonTitle,
        totals: `Students: ${students.length}; answered at least one task: ${active.length}; tasks: ${questions.length}; answers: ${answerCount}.`,
        questionsDigest: insightsDigest,
        studentsTable,
      }),
      schema: answersSummarySchema,
      tidy: (x) => this.tidySummary(x),
      maxTokens: 2_000,
      temperature: 0.2,
      signal: ctx.signal,
      logger: ctx.logger,
      what: 'answers summary',
    });
    if (!summary) return { ok: false, error: 'bad_report' };

    const seen = new Set<string>();
    const needHelp = summary.needHelp.flatMap((n) => {
      const who = resolve(n.participant);
      if (!who || seen.has(who.label)) return [];
      seen.add(who.label);
      return [{ participant: who.label, reason: n.reason, name: who.target.name, participantId: who.target.participantId }];
    });
    const report = answersReportSchema.safeParse({
      summary: summary.summary,
      needHelp,
      teacherTips: summary.teacherTips,
      questions: questionInsights,
      feedback: students.map((s) => feedback.get(s.label)).filter((f): f is AnswersFeedbackItem => !!f),
    });
    if (!report.success) {
      ctx.logger.warn(`answers report invalid: ${report.error.issues[0]?.message ?? ''}`);
      return { ok: false, error: 'bad_report' };
    }
    return {
      ok: true,
      report: report.data,
      stats: {
        participants: students.length,
        active: active.length,
        questions: questions.length,
        answers: answerCount,
        calls,
        sampled,
      },
    };
  }

  // ── material ─────────────────────────────────────────────────────────────

  private readAnswer(q: Question, raw: string | null, completed: boolean): Answer {
    const value = (raw ?? '').trim();
    if (q.type === 'checklist') {
      const ticked = checklistIndices(raw);
      const names = ticked.map((i) => q.items[i]).filter((s): s is string => !!s);
      return {
        text: q.items.length
          ? `${ticked.length}/${q.items.length}${names.length ? ` (${names.map((n) => oneLine(n, 40)).join(', ')})` : ''}`
          : `${ticked.length}`,
        correct: null,
        answered: completed || ticked.length > 0,
        ticked: ticked.length,
      };
    }
    if (q.type === 'input_file') {
      return { text: value ? '(file uploaded)' : '', correct: null, answered: completed || !!value };
    }
    return {
      text: value,
      correct: CHOICE_TYPES.has(q.type) && q.correct.size > 0 && value ? q.correct.has(value) : null,
      answered: completed || value.length > 0,
    };
  }

  /** One question with the group's answers, capped to ~6k characters. */
  private questionMaterial(q: Question, students: Student[]): { text: string; sampled: boolean } {
    const head: string[] = [`${q.ref} [${q.type}] ${q.header}`];
    if (q.choices.length) head.push(`Options: ${q.choices.join(' | ')}`);
    if (q.correct.size) head.push(`Correct: ${[...q.correct].map((c) => oneLine(c, 120)).join(' | ')}`);
    if (q.type === 'checklist' && q.items.length) {
      head.push(`Checklist items: ${q.items.map((s) => oneLine(s, 60)).join(' | ')}`);
    }
    const given = students
      .map((s) => ({ s, a: s.answers.get(q.blockId) }))
      .filter((x): x is { s: Student; a: Answer } => !!x.a?.answered);
    head.push(`Answered: ${given.length} of ${students.length}`);
    if (given.length === 0) return { text: head.join('\n'), sampled: false };

    if (CHOICE_TYPES.has(q.type) || q.type === 'input_rating') {
      const counts = new Map<string, number>();
      for (const { a } of given) {
        const k = oneLine(a.text || '(marked done)', 120);
        counts.set(k, (counts.get(k) ?? 0) + 1);
      }
      const dist = [...counts.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 15)
        .map(([k, n]) => `"${k}" — ${n}${q.correct.size ? (q.correct.has(k) ? ' (correct)' : ' (wrong)') : ''}`);
      head.push(`Distribution: ${dist.join('; ')}`);
      if (q.type === 'input_rating') {
        const nums = given.map((x) => Number(x.a.text)).filter((n) => Number.isFinite(n));
        if (nums.length) {
          head.push(`Average: ${(nums.reduce((s, n) => s + n, 0) / nums.length).toFixed(1)}`);
        }
      }
      const wrong = given.filter((x) => x.a.correct === false).map((x) => x.s.label);
      if (wrong.length) {
        head.push(
          `Wrong: ${wrong.slice(0, 40).join(', ')}${wrong.length > 40 ? ` and ${wrong.length - 40} more` : ''}`,
        );
      }
      return { text: head.join('\n'), sampled: false };
    }
    if (q.type === 'checklist' || q.type === 'input_file') {
      const full = given.filter((x) => q.items.length > 0 && (x.a.ticked ?? 0) >= q.items.length).length;
      head.push(
        q.type === 'checklist'
          ? `Ticked every item: ${full}; partly: ${given.length - full}`
          : `Uploaded a file: ${given.length}`,
      );
      return { text: head.join('\n'), sampled: false };
    }

    // Free text: every answer, or an even sample when they do not fit.
    const lines = given.map((x) => `${x.s.label}: ${oneLine(x.a.text || '(marked done)', ANSWER_CHARS)}`);
    const total = lines.reduce((n, l) => n + l.length + 1, 0);
    if (total <= QUESTION_ANSWERS_CHARS) return { text: [...head, ...lines].join('\n'), sampled: false };
    const avg = total / lines.length;
    const fit = Math.max(1, Math.floor(QUESTION_ANSWERS_CHARS / avg));
    const step = lines.length / fit;
    const picked: string[] = [];
    let used = 0;
    for (let i = 0; i < fit; i++) {
      const line = lines[Math.floor(i * step)]!;
      if (used + line.length > QUESTION_ANSWERS_CHARS) break;
      picked.push(line);
      used += line.length + 1;
    }
    head.push(`(an even sample of ${picked.length} of ${lines.length} answers is shown)`);
    return { text: [...head, ...picked].join('\n'), sampled: true };
  }

  /** One student's answers for the feedback step. */
  private studentMaterial(s: Student, questions: Question[]): string {
    const answered = questions.filter((q) => s.answers.get(q.blockId)?.answered);
    const tests = questions.filter((q) => q.correct.size > 0 && CHOICE_TYPES.has(q.type));
    const right = tests.filter((q) => s.answers.get(q.blockId)?.correct === true).length;
    const lines = [
      `${s.label} — answered ${answered.length} of ${questions.length} tasks` +
        (tests.length ? `; test answers correct: ${right} of ${tests.length}` : ''),
    ];
    for (const q of answered) {
      const a = s.answers.get(q.blockId)!;
      const mark = a.correct === true ? ' (correct)' : a.correct === false ? ' (wrong)' : '';
      lines.push(`  ${q.ref}: ${oneLine(a.text || '(marked done)', STUDENT_ANSWER_CHARS)}${mark}`);
    }
    const missing = questions.filter((q) => !s.answers.get(q.blockId)?.answered).map((q) => q.ref);
    if (missing.length) lines.push(`  no answer: ${missing.slice(0, 30).join(', ')}`);
    return lines.join('\n');
  }

  // ── tidy: within the schema's hard limits before validating ──────────────

  private tidyQuestions(input: unknown): unknown {
    if (!input || typeof input !== 'object') return input;
    const r = input as Record<string, unknown>;
    return {
      questions: objects(r.questions, 40).map((q) => ({
        ref: typeof q.ref === 'string' ? q.ref.trim().toUpperCase() : q.ref,
        title: cut(q.title, 200),
        understood: typeof q.understood === 'string' ? q.understood.trim().slice(0, 600) : '',
        mistakes: strings(q.mistakes, 5, 300),
        bestAnswers: objects(q.bestAnswers, 3)
          .filter((b) => typeof b.quote === 'string' && b.quote.trim())
          .map((b) => ({ participant: cut(b.participant, 40), quote: cut(b.quote, 300) })),
      })),
    };
  }

  private tidyFeedback(input: unknown): unknown {
    if (!input || typeof input !== 'object') return input;
    const r = input as Record<string, unknown>;
    return {
      feedback: objects(r.feedback, 60)
        .filter((f) => typeof f.text === 'string' && f.text.trim())
        .map((f) => ({
          participant: cut(f.participant, 40),
          text: cut(f.text, 700),
          needsHelp: f.needsHelp === true || f.needsHelp === 'true',
        })),
    };
  }

  private tidySummary(input: unknown): unknown {
    if (!input || typeof input !== 'object') return input;
    const r = input as Record<string, unknown>;
    return {
      summary: cut(r.summary, 2000),
      needHelp: objects(r.needHelp, 60)
        .filter((n) => typeof n.reason === 'string' && n.reason.trim())
        .map((n) => ({ participant: cut(n.participant, 40), reason: cut(n.reason, 400) })),
      teacherTips: strings(r.teacherTips, 6, 400),
    };
  }
}
