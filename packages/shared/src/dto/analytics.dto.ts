import type {
  BlockType,
  SessionStatus,
  LessonProgressViewStatus,
} from '../enums.js';

/**
 * Reports & analytics response types (docs/09).
 *
 * These are RESPONSE shapes only — the data is aggregated on the API and the
 * frontend just renders it (charts get ready-made numbers). No zod schemas here
 * because nothing inbound is validated against them.
 */

// ── Teacher: session reports ──────────────────────────────────────────────

/** One row in `GET /lessons/:id/sessions` (session list with counters). */
export type SessionListItem = {
  id: string;
  code: string;
  status: SessionStatus;
  participantCount: number;
  responseCount: number;
  startTime?: string | null;
  endTime?: string | null;
  createdAt?: string | null;
};

/** A participant's roll-up in a session report. */
export type SessionReportParticipant = {
  participant: { id: string; name: string };
  progressPercent: number;
  answers: Array<{
    blockId: string;
    answerText: string | null;
    isCompleted: boolean;
    updatedAt?: string | null;
  }>;
};

/** A block grouped with every participant answer to it. */
export type SessionReportBlock = {
  block: {
    id: string;
    type: BlockType;
    content: string | null;
  };
  responses: Array<{
    participant: string | null;
    answer: string | null;
    at?: string | null;
  }>;
};

/** Full detail for `GET /sessions/:id/report`. */
export type SessionReport = {
  session: {
    id: string;
    code: string;
    status: SessionStatus;
    lessonId: string | null;
    startTime?: string | null;
    endTime?: string | null;
  };
  totals: {
    participants: number;
    responses: number;
    avgProgress: number;
  };
  byParticipant: SessionReportParticipant[];
  byBlock: SessionReportBlock[];
  /** Per-block aggregates for the Метрики/Рейтинги tabs (optional). */
  ratings?: RatingMetric[];
  tests?: TestMetric[];
};

/** Aggregate for an `input_rating` block. */
export type RatingMetric = {
  blockId: string;
  content: string | null;
  average: number;
  count: number;
  /** Distribution keyed by rating value (e.g. "1".."5"). */
  distribution: Record<string, number>;
};

/** Aggregate for a `test` block. */
export type TestMetric = {
  blockId: string;
  content: string | null;
  /** Percentage of answers that matched the correct option(s). */
  correctPercent: number;
  total: number;
  correct: number;
};

// ── Company analytics ─────────────────────────────────────────────────────

/** Summary for `GET /analytics/company`. */
export type CompanyStats = {
  totalStudents: number;
  active30d: number;
  avgProgress: number;
  completedLessons: number;
};

/** Per-employee drilldown (`GET /analytics/company/users/:userId`). */
export type CompanyUserDetail = {
  user: {
    id: string;
    fullName: string | null;
    email: string;
  };
  status: 'active' | 'inactive' | 'completed';
  avgProgress: number;
  lessons: Array<{
    lessonId: string;
    title: string;
    status: LessonProgressViewStatus;
    progressPercent: number;
    completedAt?: string | null;
    lastAccessedAt?: string | null;
  }>;
};
