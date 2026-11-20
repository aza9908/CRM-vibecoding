import { z } from 'zod';

/**
 * Student rating («Рейтинг») — points for workbook work done in live lessons.
 *
 * Computed on the fly from `participants` + `responses` (no table of its own).
 * The point rules live here so the API that computes them and the web pages
 * that explain them can never disagree.
 */

/** How many points each kind of work is worth. */
export const STUDENT_RATING_POINTS = {
  /** Every workbook block the student answered (non-empty answer or marked done). */
  answeredBlock: 5,
  /** Extra, on top of `answeredBlock`, for a completed REQUIRED block (`options.required`). */
  requiredBlock: 10,
  /** Bonus for completing every required block of a lesson. */
  allRequiredBonus: 20,
  /** Each lesson the student joined (attended a live session of). */
  lessonAttended: 2,
  /**
   * Each project stage reached on a lesson's status board (the teacher ticks
   * it), counted from the first stage: stage 0 «Идея» = 0, stage 5 = 50.
   * The best stage per board counts once.
   */
  projectStage: 10,
} as const;

/**
 * Lessons that are not real classes (automatic call / load checks) never
 * count. They are marked with this category and/or an «(авто)» title suffix.
 */
export const SERVICE_LESSON_CATEGORY = 'Служебное';

/** How many leaders the compact views (student portal, live lesson) show. */
export const STUDENT_RATING_TOP = 10;

export const studentRatingPeriodSchema = z.enum(['all', '30d']);
export type StudentRatingPeriod = z.infer<typeof studentRatingPeriodSchema>;

/** Query of `GET /rating`. An empty/missing category means «all companies». */
export const studentRatingQuerySchema = z.object({
  category: z
    .string()
    .trim()
    .max(200)
    .optional()
    .transform((v) => (v ? v : undefined)),
  period: studentRatingPeriodSchema.default('all'),
});
export type StudentRatingQuery = z.infer<typeof studentRatingQuerySchema>;

/** One ranked student in the staff table. Names only — never contacts. */
export type StudentRatingRow = {
  /** Competition rank: equal points share a place (1, 1, 3…). */
  rank: number;
  name: string;
  points: number;
  /** Distinct lessons attended. */
  lessons: number;
  /** Distinct workbook blocks answered. */
  answered: number;
  /** Distinct required blocks completed. */
  requiredDone: number;
  /** Highest project stage reached on a status board (0-based), or null. */
  projectStage: number | null;
  /** Title of that stage (e.g. «MVP работает»), or null. */
  projectStageTitle: string | null;
  /** ISO time of the latest join or answer; null when unknown. */
  lastActivity: string | null;
};

/** A company tile on the rating page (lesson category with real classes). */
export type StudentRatingCategory = {
  name: string;
  /** Students with at least one point in this category (current period). */
  students: number;
};

/** `GET /rating` — staff view of the organization's rating. */
export type StudentRatingResponse = {
  period: StudentRatingPeriod;
  category: string | null;
  categories: StudentRatingCategory[];
  rows: StudentRatingRow[];
  generatedAt: string;
};

/** A leader in the compact top lists: name and points only. */
export type StudentRatingTopEntry = {
  rank: number;
  name: string;
  points: number;
};

/** The caller's own standing. `rank` is null when they have no points yet. */
export type StudentRatingMine = {
  points: number;
  rank: number | null;
  /** How many students are ranked in this rating. */
  total: number;
  lessons: number;
  answered: number;
  requiredDone: number;
};

/** `GET /rating/me` — a logged-in student's standing in their organization. */
export type MyStudentRatingResponse = {
  me: StudentRatingMine;
  top: StudentRatingTopEntry[];
};

/** `GET /sessions/:id/rating` — the live lesson's company rating. */
export type SessionStudentRatingResponse = {
  /** Category (company) of the session's lesson; null = whole organization. */
  category: string | null;
  top: StudentRatingTopEntry[];
  /** The caller's standing when they are a participant of the session. */
  me: StudentRatingMine | null;
};
