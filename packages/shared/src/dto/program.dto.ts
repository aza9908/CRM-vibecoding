import { z } from 'zod';

/**
 * Program-of-study management DTOs (docs/03 §5): create/rename the org's
 * single course and manage its modules. Reading the resulting tree still goes
 * through `GET /curriculum` (`curriculum.dto` lives inline in `lesson.dto.ts`)
 * — these are mutation-only, restricted to teacher/admin.
 */

/** Body for `POST /program/course` — creates the org's course on first call,
 * or patches its title/description on subsequent calls (idempotent upsert). */
export const upsertCourseSchema = z.object({
  title: z.string().min(1),
  description: z.string().optional(),
});
export type UpsertCourseDto = z.infer<typeof upsertCourseSchema>;

/** Body for `POST /program/modules`. */
export const createModuleSchema = z.object({
  title: z.string().min(1),
  code: z.string().min(1).max(20).optional(),
});
export type CreateModuleDto = z.infer<typeof createModuleSchema>;

/** Body for `PATCH /program/modules/:id`. */
export const updateModuleSchema = z.object({
  title: z.string().min(1).optional(),
  code: z.string().max(20).nullable().optional(),
  order: z.number().int().min(0).optional(),
});
export type UpdateModuleDto = z.infer<typeof updateModuleSchema>;

/** A course row as returned by the program endpoints. */
export type CourseDto = {
  id: string;
  organizationId: string;
  title: string;
  description: string | null;
};

/** A module row as returned by the program endpoints. */
export type ModuleDto = {
  id: string;
  courseId: string;
  title: string;
  code: string | null;
  order: number;
};
