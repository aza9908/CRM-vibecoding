import { z } from 'zod';
import {
  scheduleEventTypeEnum,
  type ScheduleEventState,
  type ScheduleEventType,
} from '../enums.js';

/**
 * Study-schedule DTOs — the company's program laid out on a timeline, from the
 * first lesson through every Q&A to Demo day.
 *
 * Reading is open to any authenticated user (it is what the личный кабинет
 * renders); writing is restricted to `PROGRAM_EDITOR_ROLES`. Events are
 * org-scoped and may optionally point at a lesson, which links a timeline entry
 * to the workbook the student will actually open.
 */

/** Body for `POST /schedule`. */
export const createScheduleEventSchema = z.object({
  title: z.string().trim().min(1).max(300),
  type: scheduleEventTypeEnum,
  /** ISO date-time with offset — the schedule is company-wide, so it is
   * always stored as an absolute instant, never a floating local time. */
  startsAt: z.string().datetime({ offset: true }),
  endsAt: z.string().datetime({ offset: true }).nullable().optional(),
  description: z.string().trim().max(2000).nullable().optional(),
  /** Room, city, or "онлайн". */
  location: z.string().trim().max(200).nullable().optional(),
  /** Zoom/Meet link shown on the timeline card. */
  meetingUrl: z.string().url().max(2000).nullable().optional(),
  /** Optional link to the lesson whose workbook this event runs on. */
  lessonId: z.string().uuid().nullable().optional(),
});
export type CreateScheduleEventDto = z.infer<typeof createScheduleEventSchema>;

/** Body for `PATCH /schedule/:id` — every field optional. */
export const updateScheduleEventSchema = createScheduleEventSchema.partial();
export type UpdateScheduleEventDto = z.infer<typeof updateScheduleEventSchema>;

/** One entry on the timeline. */
export type ScheduleEventDto = {
  id: string;
  title: string;
  type: ScheduleEventType;
  startsAt: string;
  endsAt: string | null;
  description: string | null;
  location: string | null;
  meetingUrl: string | null;
  lessonId: string | null;
  /** Title of the linked lesson, resolved by the API for display. */
  lessonTitle: string | null;
  /** Derived from the clock at request time — never stored. */
  state: ScheduleEventState;
};

/**
 * Response of `GET /schedule`: the whole program in chronological order plus
 * the headline numbers the cabinet shows above the timeline.
 */
export type ScheduleTimelineDto = {
  /** Title of the org's course, when it has one. */
  courseTitle: string | null;
  companyName: string | null;
  events: ScheduleEventDto[];
  /** First and last event instants — the span of the whole program. */
  startsAt: string | null;
  endsAt: string | null;
  /** Index into `events` of the next event that has not finished yet. */
  nextEventId: string | null;
  counts: {
    total: number;
    past: number;
    lessons: number;
    qa: number;
    demoDay: number;
  };
};
