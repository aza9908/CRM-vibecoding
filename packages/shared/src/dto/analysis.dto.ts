import { z } from 'zod';

/**
 * «ИИ-разбор урока» — the AI analysis of a recorded lesson: its audio is
 * transcribed, then an LLM reports the lesson's strong and weak sides.
 * The report shape below is the single contract between the API (which asks
 * the model for exactly this JSON and validates it) and the web UI.
 */

/** A position in the recording, `mm:ss` (or `h:mm:ss` for long lessons). */
const timestamp = z
  .string()
  .trim()
  .regex(/^(\d{1,2}:)?\d{1,3}:\d{2}$/);
const score = z.number().min(1).max(10);

export const lessonAnalysisReportSchema = z.object({
  /** 2–4 sentences: what the lesson was and how it went. */
  summary: z.string().trim().min(1).max(2000),
  score: z.object({
    overall: score,
    clarity: score,
    structure: score,
    engagement: score,
    pace: score,
    practice: score,
  }),
  strengths: z
    .array(
      z.object({
        title: z.string().trim().min(1).max(200),
        /** A quote or a concrete moment from the transcript. */
        evidence: z.string().trim().min(1).max(600),
        at: timestamp.optional(),
      }),
    )
    .max(8),
  weaknesses: z
    .array(
      z.object({
        title: z.string().trim().min(1).max(200),
        evidence: z.string().trim().min(1).max(600),
        at: timestamp.optional(),
        /** What to do differently next time. */
        fix: z.string().trim().min(1).max(600),
      }),
    )
    .max(8),
  timeline: z
    .array(
      z.object({
        from: timestamp,
        to: timestamp,
        topic: z.string().trim().min(1).max(200),
        note: z.string().trim().max(400).optional(),
      }),
    )
    .max(24),
  engagement: z.object({
    /** Share of the talking done by the teacher, 0–100. */
    teacherTalkShare: z.number().min(0).max(100).optional(),
    studentQuestions: z.number().int().min(0),
    /** One sentence about the «Пульс класса» checks, if there were any. */
    pulse: z.string().trim().max(400).optional(),
    /** Names of people who stayed passive. */
    passive: z.array(z.string().trim().min(1).max(120)).max(50).optional(),
  }),
  /** Concrete actions for the next lesson, most important first. */
  recommendations: z.array(z.string().trim().min(1).max(400)).max(5),
  quotes: z
    .array(z.object({ at: timestamp, text: z.string().trim().min(1).max(400) }))
    .max(8)
    .optional(),
});
export type LessonAnalysisReport = z.infer<typeof lessonAnalysisReportSchema>;

export const LESSON_ANALYSIS_STATUSES = [
  'queued',
  'processing',
  'done',
  'failed',
] as const;
export type LessonAnalysisStatus = (typeof LESSON_ANALYSIS_STATUSES)[number];

/** What the job is doing right now (drives the progress label in the UI). */
export const LESSON_ANALYSIS_STAGES = [
  'queued',
  'transcribing',
  'context',
  'notes',
  'report',
  'done',
] as const;
export type LessonAnalysisStage = (typeof LESSON_ANALYSIS_STAGES)[number];

/** Languages a report can be written in (the teacher's UI locale). */
export const LESSON_ANALYSIS_LOCALES = ['ru', 'uz', 'kk', 'en'] as const;
export type LessonAnalysisLocale = (typeof LESSON_ANALYSIS_LOCALES)[number];

/** Client-generated id of one recording: ties the audio pieces together. */
export const analysisRecordingIdSchema = z.string().regex(/^[\w-]{8,64}$/);

/** Max size of one uploaded audio piece. */
export const ANALYSIS_AUDIO_PIECE_MAX_BYTES = 1024 * 1024;
/** Whisper's file limit — at 24 kbps this is about 2 h 15 min of audio. */
export const ANALYSIS_AUDIO_MAX_BYTES = 25 * 1024 * 1024;

/** Fields of `POST /sessions/:id/analysis/audio` (multipart, next to `file`). */
export const uploadAnalysisAudioSchema = z.object({
  recordingId: analysisRecordingIdSchema,
  seq: z.coerce.number().int().min(0).max(100_000),
});
export type UploadAnalysisAudioDto = z.infer<typeof uploadAnalysisAudioSchema>;

/** Body of `POST /sessions/:id/analysis/finish`. */
export const finishAnalysisSchema = z.object({
  recordingId: analysisRecordingIdSchema,
  title: z.string().trim().min(1).max(200),
  locale: z.enum(LESSON_ANALYSIS_LOCALES).catch('ru'),
  mimeType: z.string().trim().max(100).optional(),
  durationSec: z.number().int().min(0).max(6 * 3600).optional(),
});
export type FinishAnalysisDto = z.infer<typeof finishAnalysisSchema>;

/** One analysis as the API returns it. */
export interface LessonAnalysis {
  id: string;
  sessionId: string;
  lessonId: string | null;
  status: LessonAnalysisStatus;
  /** 0–100. */
  progress: number;
  stage: LessonAnalysisStage;
  title: string;
  locale: LessonAnalysisLocale;
  durationSec: number | null;
  /** Timestamped transcript (`[mm:ss] text` per line); null until ready. */
  transcript: string | null;
  report: LessonAnalysisReport | null;
  /** Machine-readable failure reason (e.g. `audio_too_large`). */
  error: string | null;
  createdAt: string;
  finishedAt: string | null;
}
