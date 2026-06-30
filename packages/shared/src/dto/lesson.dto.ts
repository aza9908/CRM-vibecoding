import { z } from 'zod';
import { blockTypeEnum, lessonTypeEnum, type ProgressStatus } from '../enums.js';

/**
 * Lesson / workbook DTOs and the curriculum tree shape.
 *
 * `blockSchema` matches the editable fields of the `lesson_blocks` table.
 * `order_index` is intentionally NOT part of the DTO — the bulk-save endpoint
 * (`PUT /lessons/:id/blocks`) derives ordering from the array index, so the
 * client just sends blocks already sorted after drag-and-drop.
 */

/** A single workbook block as edited on the client / sent to the API. */
export const blockSchema = z.object({
  id: z.string().uuid().optional(),
  type: blockTypeEnum,
  content: z.string().nullable().optional(),
  imageUrl: z.string().url().nullable().optional(),
  options: z.unknown().nullable().optional(),
  outcomeId: z.string().uuid().nullable().optional(),
  blockRole: z.string().nullable().optional(),
  generatedBy: z.enum(['manual', 'ai']).optional(),
});
export type BlockDto = z.infer<typeof blockSchema>;

/** Body for `POST /lessons`. */
export const createLessonSchema = z.object({
  title: z.string().min(1),
  type: lessonTypeEnum.optional(),
  moduleId: z.string().uuid().optional(),
});
export type CreateLessonDto = z.infer<typeof createLessonSchema>;

/** Body for `PATCH /lessons/:id`. */
export const updateLessonSchema = createLessonSchema.partial();
export type UpdateLessonDto = z.infer<typeof updateLessonSchema>;

/** Body for `PUT /lessons/:id/blocks` — bulk save (upsert + orphan delete). */
export const saveBlocksSchema = z.object({
  blocks: z.array(blockSchema),
});
export type SaveBlocksDto = z.infer<typeof saveBlocksSchema>;

/**
 * Body for `POST /uploads/presign`.
 *
 * `scope` selects the key prefix: `lesson-media` (block images, public) or
 * `course-materials` (private material files served via presigned GET).
 */
export const presignScopeEnum = z.enum(['lesson-media', 'course-materials']);
export type PresignScope = z.infer<typeof presignScopeEnum>;

export const presignSchema = z.object({
  filename: z.string(),
  contentType: z.string(),
  // Optional: absent defaults to 'lesson-media' in the presign route.
  scope: presignScopeEnum.optional(),
});
export type PresignDto = z.infer<typeof presignSchema>;

// ── Curriculum tree (GET /curriculum) ─────────────────────────────────────

/** A learning outcome attached to a lesson. */
export type CurriculumOutcome = {
  id: string;
  title: string;
};

/**
 * A lesson node in the curriculum tree.
 * `progressStatus` is merged in only for the student view (started/completed),
 * and is absent for the teacher view.
 */
export type CurriculumLesson = {
  id: string;
  title: string;
  type: z.infer<typeof lessonTypeEnum>;
  order: number;
  outcomes: CurriculumOutcome[];
  progressStatus?: ProgressStatus;
  /** 0–100 lesson progress (student view); absent for the teacher view. */
  progressPercent?: number;
};

/** A module (M1/M2/...) grouping ordered lessons. */
export type CurriculumModule = {
  id: string;
  code: string | null;
  title: string;
  order: number;
  lessons: CurriculumLesson[];
  /** Average lesson progress across the module (student view). */
  progressPercent: number;
};

/** The full program-of-study tree for one course. */
export type CurriculumTree = {
  course: {
    id: string;
    title: string;
  } | null;
  modules: CurriculumModule[];
};
