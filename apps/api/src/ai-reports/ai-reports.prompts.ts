import type { AiReportLocale } from '@lms/shared';
import { LLM_TASK_MARKER, type ChatMessage } from '../ai/providers/llm-provider.interface';

/**
 * Prompts of «ИИ-анализ ответов» and «ИИ-куратор» — same style as
 * `analysis/analysis.prompts.ts`: a task marker (so the mock provider can
 * answer offline), shared honesty rules, the exact JSON shape, and the data
 * in the user turn. Students only ever appear as anonymous labels; names,
 * phones, emails and companies of participants are never put in a prompt.
 */

export const LANGUAGE_NAME: Record<AiReportLocale, string> = {
  ru: 'Russian',
  uz: 'Uzbek (Latin script)',
  kk: 'Kazakh',
  en: 'English',
};

/** Label of the n-th student in the answers prompts (1-based). */
export const participantLabel = (n: number) => `Участник ${n}`;
/** Label of the n-th learner in the curator prompts (1-based). */
export const learnerLabel = (n: number) => `Ученик ${n}`;

const PRIVACY_RULES = `- Students are anonymised as «Участник N» / «Ученик N». Copy these labels EXACTLY as given (same word, same number) — never invent, rename, merge or translate them, and never guess real names.`;

const ANSWERS_RULES = `Rules:
- Use ONLY the questions and answers given. Never invent answers, numbers or quotes.
${PRIVACY_RULES}
- Answers are typed quickly during a live lesson: judge the idea, not spelling. The lesson is usually in Russian, sometimes mixed with Uzbek or Kazakh.
- Quotes are short (at most ~25 words) and verbatim from an answer.
- Be specific, kind and honest — like an experienced teacher who wants every student to succeed.`;

// ── «ИИ-анализ ответов» ──────────────────────────────────────────────────────

/** Map step: insights about one group of workbook questions. */
export function answersQuestionsMessages(input: {
  locale: AiReportLocale;
  lessonTitle: string;
  totalStudents: number;
  material: string;
}): ChatMessage[] {
  const language = LANGUAGE_NAME[input.locale];
  return [
    {
      role: 'system',
      content: `${LLM_TASK_MARKER.answersQuestions}
You are an experienced teacher reading how a group answered workbook questions during a live lesson, so the teacher can see what the group understood.
${ANSWERS_RULES}
For EVERY question given (by its ref, e.g. "Q3") write:
- "title": the question in a few words;
- "understood": 1–2 sentences on what most of the group understood or did well (or that few answered);
- "mistakes": up to 3 common mistakes or misconceptions (empty when there are none);
- "bestAnswers": up to 2 of the strongest answers, quoted briefly, with the student's label (empty for choice questions).
Write every text value in ${language}. Keep JSON keys exactly as given.
Answer with ONE JSON object and nothing else:
{ "questions": [{ "ref": "Q1", "title": string, "understood": string, "mistakes": string[], "bestAnswers": [{ "participant": "Участник 2", "quote": string }] }] }`,
    },
    {
      role: 'user',
      content: `Lesson: ${input.lessonTitle}
Students in the session: ${input.totalStudents}

QUESTIONS AND ANSWERS:
${input.material}`,
    },
  ];
}

/** Students step: personal feedback for one batch of students. */
export function answersFeedbackMessages(input: {
  locale: AiReportLocale;
  lessonTitle: string;
  questionsDigest: string;
  material: string;
}): ChatMessage[] {
  const language = LANGUAGE_NAME[input.locale];
  return [
    {
      role: 'system',
      content: `${LLM_TASK_MARKER.answersFeedback}
You are a kind, experienced teacher writing short personal feedback to each student after a live lesson, based on their workbook answers.
${ANSWERS_RULES}
For EVERY student given write "text": 1–3 sentences addressed to the student («вы»), naming something concrete they did well and one concrete thing to improve or try next. No generic praise, no grades.
Set "needsHelp": true when the student clearly needs the teacher's attention (most answers missing, wrong or off-topic); otherwise false.
Write every text value in ${language}. Keep JSON keys exactly as given.
Answer with ONE JSON object and nothing else:
{ "feedback": [{ "participant": "Участник 1", "text": string, "needsHelp": boolean }] }`,
    },
    {
      role: 'user',
      content: `Lesson: ${input.lessonTitle}

THE QUESTIONS (for reference):
${input.questionsDigest}

EACH STUDENT'S ANSWERS:
${input.material}`,
    },
  ];
}

/** Reduce step: the group summary, who needs help, tips for the teacher. */
export function answersSummaryMessages(input: {
  locale: AiReportLocale;
  lessonTitle: string;
  totals: string;
  questionsDigest: string;
  studentsTable: string;
}): ChatMessage[] {
  const language = LANGUAGE_NAME[input.locale];
  return [
    {
      role: 'system',
      content: `${LLM_TASK_MARKER.answersSummary}
You are an experienced teaching coach. From the per-question insights and the per-student table of a live lesson's workbook, write the group-level part of the report for the teacher.
${ANSWERS_RULES}
- "summary": 2–5 sentences on how the group did: participation, what was understood, where the group struggled.
- "needHelp": students who need the teacher's attention, each with a short concrete reason (from the table: missing answers, wrong test answers, the "flag" column). At most 15, most urgent first; empty when nobody does.
- "teacherTips": 2–5 concrete suggestions for the next lesson (what to repeat, which question to discuss, how to engage the silent ones).
Write every text value in ${language}. Keep JSON keys exactly as given.
Answer with ONE JSON object and nothing else:
{ "summary": string, "needHelp": [{ "participant": "Участник 4", "reason": string }], "teacherTips": string[] }`,
    },
    {
      role: 'user',
      content: `Lesson: ${input.lessonTitle}
${input.totals}

PER-QUESTION INSIGHTS:
${input.questionsDigest}

STUDENTS (label: answered / tasks; test: correct / tests; flag):
${input.studentsTable}`,
    },
  ];
}

// ── «ИИ-куратор» ────────────────────────────────────────────────────────────

const CURATOR_RULES = `Rules:
- Use ONLY the data given (program numbers, learner table, lesson list, analysis summaries). Never invent numbers, names, dates or events.
${PRIVACY_RULES}
- You report to a corporate client: be clear, factual and constructive, like a learning & development manager. Numbers come from the data; when the data is too thin to judge, say so.
- A learner is "at risk" when they miss lessons, have not been active recently, or skip required checkpoints. Each next step must be concrete and doable this week (e.g. "позвонить и предложить запись урока 3", "попросить сдать чек-лист урока 2").`;

const CURATOR_SHAPE = `{
  "overview": {
    "summary": string,            // 2–4 sentences: how the program is going for this company
    "attendance": string,         // 1–2 sentences with numbers
    "completion": string,         // required checkpoints / workbook completion, with numbers
    "engagement": string,         // activity, answers, recent activity
    "trend": "up" | "flat" | "down" | "unknown",
    "trendNote": string           // why: compare earlier and later lessons
  },
  "atRisk": [{ "learner": "Ученик 3", "reason": string, "nextStep": string }],   // at most 15, most urgent first
  "topPerformers": [{ "learner": "Ученик 1", "why": string }],                   // at most 5
  "trainerActions": string[],     // 3–6: what to repeat, whom to call, what to change
  "hrMessage": string,            // see below
  "learnerSteps": [{ "learner": "Ученик 1", "step": string }]                  // see below
}`;

/** Main curator call: the whole report for one company. */
export function curatorReportMessages(input: {
  locale: AiReportLocale;
  company: string;
  /** False when the learner steps are written in separate batches. */
  withSteps: boolean;
  material: string;
}): ChatMessage[] {
  const language = LANGUAGE_NAME[input.locale];
  return [
    {
      role: 'system',
      content: `${LLM_TASK_MARKER.curatorReport}
You are «ИИ-куратор», the AI curator of a corporate training program. You help one trainer run training for a large company: you watch progress, find learners at risk, and prepare what the trainer and the client's HR need.
${CURATOR_RULES}
- "hrMessage": a short, polite message (5–10 sentences) the trainer can send to the company's HR as is: program progress with 2–3 key numbers, what is going well, who needs support (by label is NOT allowed here — refer to groups, e.g. "трое участников пропустили два последних урока"), and what we propose. Write it in Russian${input.locale === 'ru' ? '' : ` (the rest of the report is in ${language})`}. No placeholders like [Имя].
- ${input.withSteps ? '"learnerSteps": one short next step (one sentence) for EVERY learner in the table.' : '"learnerSteps": leave it as an empty array — the steps are written separately.'}
Write every other text value in ${language}. Keep JSON keys exactly as given.
Answer with ONE JSON object and nothing else, in exactly this shape:
${CURATOR_SHAPE}`,
    },
    {
      role: 'user',
      content: `Company (client): ${input.company}

${input.material}`,
    },
  ];
}

/** Steps batch: one next step per learner, for a big company. */
export function curatorStepsMessages(input: {
  locale: AiReportLocale;
  company: string;
  context: string;
  learners: string;
}): ChatMessage[] {
  const language = LANGUAGE_NAME[input.locale];
  return [
    {
      role: 'system',
      content: `${LLM_TASK_MARKER.curatorSteps}
You are «ИИ-куратор», the AI curator of a corporate training program. For EVERY learner given, write one short, concrete next step (one sentence) that fits their numbers: catch up on a missed lesson, finish required checkpoints, keep the pace, take on a harder task, help others.
${CURATOR_RULES}
Write every text value in ${language}. Keep JSON keys exactly as given.
Answer with ONE JSON object and nothing else:
{ "learnerSteps": [{ "learner": "Ученик 1", "step": string }] }`,
    },
    {
      role: 'user',
      content: `Company (client): ${input.company}
${input.context}

LEARNERS:
${input.learners}`,
    },
  ];
}
