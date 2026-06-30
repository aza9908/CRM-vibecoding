import { z } from 'zod';
import { materialTypeEnum, type MaterialType } from '../enums.js';

/**
 * Material DTOs (docs/07).
 *
 * A material is either a `file` (url = S3 key in the private `course-materials/`
 * bucket) or a `link` (url = external href). `lessonIds` attaches the material
 * to one or more lessons via the `lesson_materials` junction; on update, passing
 * `lessonIds` re-creates the full set of links.
 */

/** Body for `POST /materials`. */
export const createMaterialSchema = z.object({
  title: z.string().min(1),
  type: materialTypeEnum,
  url: z.string().min(1),
  lessonIds: z.array(z.string().uuid()).optional(),
});
export type CreateMaterialDto = z.infer<typeof createMaterialSchema>;

/** Body for `PATCH /materials/:id` — all fields optional (incl. lessonIds). */
export const updateMaterialSchema = z.object({
  title: z.string().min(1).optional(),
  type: materialTypeEnum.optional(),
  url: z.string().min(1).optional(),
  lessonIds: z.array(z.string().uuid()).optional(),
});
export type UpdateMaterialDto = z.infer<typeof updateMaterialSchema>;

/** A material row as returned by the API. */
export type MaterialDto = {
  id: string;
  organizationId: string;
  createdBy: string | null;
  title: string;
  type: MaterialType;
  url: string;
  createdAt: string;
};

/**
 * A material as seen from a particular lesson (student right-panel view).
 * The raw `url` (S3 key) is intentionally omitted: files are fetched through
 * `GET /materials/:id/download`, which mints a short-lived presigned GET.
 */
export type LessonMaterial = {
  id: string;
  title: string;
  type: MaterialType;
};
