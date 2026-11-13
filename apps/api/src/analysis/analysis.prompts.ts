import type { LessonAnalysisLocale } from '@lms/shared';
import {
  LLM_TASK_MARKER,
  type ChatMessage,
  type TranscriptSegment,
} from '../ai/providers/llm-provider.interface';

/** `75` → `01:15`, `3725` → `1:02:05`. */
export function formatStamp(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(sec)}` : `${pad(m)}:${pad(sec)}`;
}

/** One line per segment: `[mm:ss] text`. */
export function transcriptLines(segments: TranscriptSegment[]): string[] {
  return segments.map((s) => `[${formatStamp(s.start)}] ${s.text}`);
}

/** A stretch of the lesson small enough for one "notes" call. */
export interface TranscriptWindow {
  from: number;
  to: number;
  text: string;
}

/**
 * Cut the transcript into windows of at most ~7 minutes / ~9 000 characters
 * (≈2.5k tokens of Russian), so each notes call stays well inside low
 * tokens-per-minute limits and a 1.5 h lesson becomes ~13–15 calls.
 */
export function splitIntoWindows(
  segments: TranscriptSegment[],
  maxSeconds = 7 * 60,
  maxChars = 9_000,
): TranscriptWindow[] {
  const windows: TranscriptWindow[] = [];
  let lines: string[] = [];
  let chars = 0;
  let from = 0;
  let to = 0;
  const flush = () => {
    if (lines.length === 0) return;
    windows.push({ from, to, text: lines.join('\n') });
    lines = [];
    chars = 0;
  };
  for (const seg of segments) {
    const line = `[${formatStamp(seg.start)}] ${seg.text}`;
    if (lines.length > 0 && (seg.end - from > maxSeconds || chars + line.length > maxChars)) {
      flush();
    }
    if (lines.length === 0) from = seg.start;
    lines.push(line);
    chars += line.length + 1;
    to = seg.end;
  }
  flush();
  return windows;
}

const LANGUAGE_NAME: Record<LessonAnalysisLocale, string> = {
  ru: 'Russian',
  uz: 'Uzbek (Latin script)',
  kk: 'Kazakh',
  en: 'English',
};

const HONESTY_RULES = `Rules:
- Use ONLY what is in the transcript and the lesson context. Never invent facts, names, numbers or quotes.
- Every strength and weakness needs evidence: a short quote from the transcript or a concrete moment, with its timestamp when you can point to one.
- Timestamps are copied from the transcript's [mm:ss] marks, never guessed.
- The transcript is automatic speech recognition: it has no speaker labels and may contain recognition errors; the lesson is mostly in Russian, sometimes mixed with Uzbek or Kazakh. Infer who speaks from context (the teacher explains and asks, students ask short questions) and stay cautious when unsure.
- Be specific, kind and honest — like an experienced teaching coach, not a cheerleader and not a critic.
- If the recording is too short or too quiet to judge something, say so plainly instead of guessing.`;

/** Map step: structured notes about one window of the lesson. */
export function notesMessages(window: TranscriptWindow, lessonTitle: string): ChatMessage[] {
  return [
    {
      role: 'system',
      content: `${LLM_TASK_MARKER.analysisNotes}
You are a teaching coach taking notes on one part of a recorded live lesson so that a full review can be written later.
${HONESTY_RULES}
Answer with ONE JSON object and nothing else:
{
  "topics": string[],                               // what was covered, in order
  "explainedWell": [{ "at": "mm:ss", "note": string }],
  "unclear": [{ "at": "mm:ss", "note": string }],    // confusing, rushed or skipped explanations
  "studentQuestions": [{ "at": "mm:ss", "text": string }],
  "practice": [{ "at": "mm:ss", "note": string }],   // exercises, tasks, checks for understanding
  "pace": "slow" | "ok" | "fast",
  "offTopic": [{ "at": "mm:ss", "note": string }],   // filler, tangents, technical delays
  "quotes": [{ "at": "mm:ss", "text": string }]      // at most 2 telling quotes, verbatim
}
Keep every note under 25 words. Write the notes in Russian.`,
    },
    {
      role: 'user',
      content: `Lesson: ${lessonTitle}
Part of the lesson from ${formatStamp(window.from)} to ${formatStamp(window.to)}.

TRANSCRIPT:
${window.text}`,
    },
  ];
}

const REPORT_SHAPE = `{
  "summary": string,                                  // 2–4 sentences: what the lesson was and how it went
  "score": { "overall": 1-10, "clarity": 1-10, "structure": 1-10, "engagement": 1-10, "pace": 1-10, "practice": 1-10 },
  "strengths": [{ "title": string, "evidence": string, "at": "mm:ss" }],            // 2–5 items, strongest first
  "weaknesses": [{ "title": string, "evidence": string, "at": "mm:ss", "fix": string }], // 2–5 items; "fix" = what to do differently next time
  "timeline": [{ "from": "mm:ss", "to": "mm:ss", "topic": string, "note": string }], // the lesson's parts in order, at most 12
  "engagement": { "teacherTalkShare": 0-100, "studentQuestions": integer, "pulse": string, "passive": string[] },
  "recommendations": string[],                        // at most 5, concrete and doable in the next lesson
  "quotes": [{ "at": "mm:ss", "text": string }]       // at most 4, verbatim from the transcript
}`;

/** Reduce step: the final report from notes (or the raw transcript when short). */
export function reportMessages(input: {
  locale: LessonAnalysisLocale;
  lessonTitle: string;
  durationSec: number | null;
  context: string;
  /** Either the notes of every window or, for a short recording, the transcript itself. */
  material: string;
  materialKind: 'notes' | 'transcript';
}): ChatMessage[] {
  const language = LANGUAGE_NAME[input.locale];
  return [
    {
      role: 'system',
      content: `${LLM_TASK_MARKER.analysisReport}
You are an experienced teaching coach reviewing a recorded live lesson for its teacher. Your review names the lesson's strong and weak sides and tells the teacher what to change next time.
${HONESTY_RULES}
- "at" is optional: omit the field when you cannot point to a moment. "pulse" and "passive" come only from the lesson context (the «Пульс класса» checks); omit them when the context has none.
- Scores: 5 is an average lesson, 8+ needs clear evidence, and a recording too short to judge gets cautious middle scores with the caveat stated in "summary".
- Write every text value in ${language}. Keep JSON keys exactly as given.
Answer with ONE JSON object and nothing else, in exactly this shape:
${REPORT_SHAPE}`,
    },
    {
      role: 'user',
      content: `Lesson: ${input.lessonTitle}
Recording length: ${input.durationSec != null ? formatStamp(input.durationSec) : 'unknown'}

LESSON CONTEXT (from the LMS):
${input.context || '(none)'}

${input.materialKind === 'notes' ? 'NOTES ON EACH PART OF THE LESSON (made from the transcript)' : 'TRANSCRIPT'}:
${input.material}`,
    },
  ];
}

/** Second attempt after an answer that was not valid JSON for the schema. */
export function repairMessages(previous: ChatMessage[], badAnswer: string, problem: string): ChatMessage[] {
  return [
    ...previous,
    { role: 'assistant', content: badAnswer.slice(0, 6_000) },
    {
      role: 'user',
      content: `That answer could not be used: ${problem.slice(0, 500)}
Send the same review again as ONE valid JSON object in exactly the required shape — no markdown, no comments, no text before or after it.`,
    },
  ];
}
