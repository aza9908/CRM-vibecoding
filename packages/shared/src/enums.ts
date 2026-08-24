import { z } from 'zod';

/**
 * Shared enums — the single source of truth for both `@lms/web` and `@lms/api`.
 *
 * Each enum is declared once as a zod enum (for runtime validation) and the
 * corresponding TypeScript union type is inferred from it. The string values
 * mirror the Drizzle pgEnum definitions in `apps/api/src/db/schema.ts` exactly,
 * so DTOs validate against the same vocabulary the database stores.
 */

/**
 * Application user roles (User JWT audience).
 *
 * `curator` and `methodist` own the program of study and its schedule: today
 * an admin builds both, and these two roles exist so that work can be handed
 * over without granting full user-management rights.
 */
export const userRoleEnum = z.enum([
  'student',
  'teacher',
  'admin',
  'team_lead',
  'curator',
  'methodist',
]);
export type UserRole = z.infer<typeof userRoleEnum>;

/**
 * Roles allowed to author the program of study and its schedule. Kept as one
 * list so the API guards and the web nav can never drift apart.
 */
export const PROGRAM_EDITOR_ROLES = [
  'admin',
  'curator',
  'methodist',
] as const satisfies readonly UserRole[];

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

/**
 * Kind of entry on a company's study schedule.
 *
 * `lesson` is a regular class, `qa` a question-and-answer session, `demo_day`
 * the closing showcase. `workshop` and `other` exist so a curator never has to
 * mislabel an entry to fit it on the timeline.
 */
export const scheduleEventTypeEnum = z.enum([
  'lesson',
  'qa',
  'demo_day',
  'workshop',
  'other',
]);
export type ScheduleEventType = z.infer<typeof scheduleEventTypeEnum>;

/**
 * Where an event sits relative to now. Derived by the API from `startsAt` /
 * `endsAt` rather than stored, so the timeline can never show a stale state.
 */
export const scheduleEventStateEnum = z.enum(['past', 'today', 'upcoming']);
export type ScheduleEventState = z.infer<typeof scheduleEventStateEnum>;
