import { z } from 'zod';

/**
 * Shared enums — the single source of truth for both `@lms/web` and `@lms/api`.
 *
 * Each enum is declared once as a zod enum (for runtime validation) and the
 * corresponding TypeScript union type is inferred from it. The string values
 * mirror the Drizzle pgEnum definitions in `apps/api/src/db/schema.ts` exactly,
 * so DTOs validate against the same vocabulary the database stores.
 */

/** Application user roles (User JWT audience). */
export const userRoleEnum = z.enum(['student', 'teacher', 'admin', 'team_lead']);
export type UserRole = z.infer<typeof userRoleEnum>;

/**
 * Roles a caller may pick for THEMSELVES on public self-registration.
 * `admin` / `team_lead` are deliberately excluded — those are elevated roles
 * and must only ever be granted by an existing admin (see `admin.controller`
 * `PATCH /admin/users/:id/role`), never chosen by an anonymous registrant.
 */
export const selfRegisterRoleEnum = z.enum(['student', 'teacher']);
export type SelfRegisterRole = z.infer<typeof selfRegisterRoleEnum>;

/** How a lesson is delivered. */
export const lessonTypeEnum = z.enum(['video', 'stream', 'text']);
export type LessonType = z.infer<typeof lessonTypeEnum>;

/** Lifecycle of a live session. */
export const sessionStatusEnum = z.enum(['scheduled', 'live', 'ended']);
export type SessionStatus = z.infer<typeof sessionStatusEnum>;

/** Workbook block kinds. */
export const blockTypeEnum = z.enum([
  'text',
  'image',
  'input_text',
  'input_select',
  'input_rating',
  'action_button',
  'input_file',
  'test',
]);
export type BlockType = z.infer<typeof blockTypeEnum>;

/** Per-user, per-lesson progress state as stored in the DB enum. */
export const progressStatusEnum = z.enum(['started', 'completed']);
export type ProgressStatus = z.infer<typeof progressStatusEnum>;

/** Kind of attachable lesson material. */
export const materialTypeEnum = z.enum(['file', 'link']);
export type MaterialType = z.infer<typeof materialTypeEnum>;

/** Column/status of an internal task on the Задачи board (Trello-style). */
export const taskStatusEnum = z.enum(['todo', 'doing', 'done']);
export type TaskStatus = z.infer<typeof taskStatusEnum>;

/**
 * Lesson progress as exposed to the UI. The DB only stores 2 states
 * ('started'|'completed'); the API maps no-row → not_started,
 * 'started' → in_progress, 'completed' → completed.
 */
export const lessonProgressViewEnum = z.enum([
  'not_started',
  'in_progress',
  'completed',
]);
export type LessonProgressViewStatus = z.infer<typeof lessonProgressViewEnum>;
