import { z } from 'zod';
import type { LessonProgressViewStatus } from '../enums.js';

/**
 * Lesson-progress DTOs (docs/08).
 *
 * `PUT /lessons/:id/progress` persists the lesson-summary percent for an
 * authenticated student. The view status is derived (no row → not_started,
 * 'started' → in_progress, 'completed' → completed) — see the API mapping.
 */

/** Body for `PUT /lessons/:id/progress`. */
export const updateProgressSchema = z.object({
  percent: z.number().int().min(0).max(100),
});
export type UpdateProgressDto = z.infer<typeof updateProgressSchema>;

/** Lesson progress as exposed to the UI. */
export type LessonProgressView = {
  lessonId: string;
  status: LessonProgressViewStatus;
  progressPercent: number;
  lastAccessedAt?: string | null;
  completedAt?: string | null;
};
