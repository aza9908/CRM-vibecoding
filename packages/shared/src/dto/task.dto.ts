import { z } from 'zod';
import { taskStatusEnum, type TaskStatus } from '../enums.js';

/**
 * Internal "Задачи" board DTOs (Trello/Jira-style task tracker for the org's
 * team, docs/10). All routes are admin-only and scoped to `orgId`.
 */

/** Body for `POST /tasks`. */
export const createTaskSchema = z.object({
  title: z.string().min(1),
  description: z.string().optional(),
  assigneeId: z.string().uuid().nullable().optional(),
  deadline: z.string().date().nullable().optional(),
});
export type CreateTaskDto = z.infer<typeof createTaskSchema>;

/** Body for `PATCH /tasks/:id` — all fields optional. */
export const updateTaskSchema = z.object({
  title: z.string().min(1).optional(),
  description: z.string().nullable().optional(),
  status: taskStatusEnum.optional(),
  assigneeId: z.string().uuid().nullable().optional(),
  deadline: z.string().date().nullable().optional(),
});
export type UpdateTaskDto = z.infer<typeof updateTaskSchema>;

/** A task row as returned by the API, with the assignee's name resolved. */
export type TaskDto = {
  id: string;
  organizationId: string;
  title: string;
  description: string | null;
  status: TaskStatus;
  assigneeId: string | null;
  assigneeName: string | null;
  deadline: string | null;
  createdBy: string | null;
  createdAt: string | null;
  updatedAt: string | null;
};
