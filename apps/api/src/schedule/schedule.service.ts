import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, asc, eq } from 'drizzle-orm';
import type {
  CreateScheduleEventDto,
  ScheduleEventDto,
  ScheduleEventState,
  ScheduleTimelineDto,
  UpdateScheduleEventDto,
} from '@lms/shared';

import { DRIZZLE, type Db } from '../db/db.module';
import { courses, lessons, organizations, scheduleEvents } from '../db/schema';

type ScheduleRow = typeof scheduleEvents.$inferSelect;

/**
 * The company's study schedule — the timeline рendered in личный кабинет,
 * running from the first lesson through every Q&A to Demo day.
 *
 * Reads are open to any authenticated user in the org; writes are restricted
 * at the controller to `PROGRAM_EDITOR_ROLES` (admin today, curator/methodist
 * once that work is handed over). Every method takes `orgId` and filters on
 * it, so an event can never be read or written across tenants.
 */
@Injectable()
export class ScheduleService {
  constructor(@Inject(DRIZZLE) private readonly db: Db) {}

  /** The whole program in chronological order, plus its headline numbers. */
  async getTimeline(orgId: string): Promise<ScheduleTimelineDto> {
    const rows = await this.db
      .select({
        event: scheduleEvents,
        lessonTitle: lessons.title,
      })
      .from(scheduleEvents)
      .leftJoin(lessons, eq(lessons.id, scheduleEvents.lessonId))
      .where(eq(scheduleEvents.organizationId, orgId))
      .orderBy(asc(scheduleEvents.startsAt));

    const now = new Date();
    const events = rows.map(({ event, lessonTitle }) =>
      toDto(event, lessonTitle, now),
    );

    const [course] = await this.db
      .select({ title: courses.title })
      .from(courses)
      .where(eq(courses.organizationId, orgId))
      .orderBy(asc(courses.createdAt))
      .limit(1);

    const [org] = await this.db
      .select({ name: organizations.name })
      .from(organizations)
      .where(eq(organizations.id, orgId))
      .limit(1);

    // "Next" is the first event that has not finished yet, so a class already
    // in progress stays highlighted instead of jumping to the one after it.
    const next = events.find((e) => e.state !== 'past') ?? null;

    return {
      courseTitle: course?.title ?? null,
      companyName: org?.name ?? null,
      events,
      startsAt: events.at(0)?.startsAt ?? null,
      endsAt: events.at(-1)?.endsAt ?? events.at(-1)?.startsAt ?? null,
      nextEventId: next?.id ?? null,
      counts: {
        total: events.length,
        past: events.filter((e) => e.state === 'past').length,
        lessons: events.filter((e) => e.type === 'lesson').length,
        qa: events.filter((e) => e.type === 'qa').length,
        demoDay: events.filter((e) => e.type === 'demo_day').length,
      },
    };
  }

  async create(
    orgId: string,
    createdBy: string,
    dto: CreateScheduleEventDto,
  ): Promise<ScheduleEventDto> {
    if (dto.lessonId) {
      await this.assertLessonInOrg(dto.lessonId, orgId);
    }
    const [created] = await this.db
      .insert(scheduleEvents)
      .values({
        organizationId: orgId,
        lessonId: dto.lessonId ?? null,
        title: dto.title,
        type: dto.type,
        startsAt: new Date(dto.startsAt),
        endsAt: dto.endsAt ? new Date(dto.endsAt) : null,
        description: dto.description ?? null,
        location: dto.location ?? null,
        meetingUrl: dto.meetingUrl ?? null,
        createdBy,
      })
      .returning();
    return this.withLessonTitle(created);
  }

  async update(
    orgId: string,
    id: string,
    dto: UpdateScheduleEventDto,
  ): Promise<ScheduleEventDto> {
    await this.assertEventInOrg(id, orgId);
    if (dto.lessonId) {
      await this.assertLessonInOrg(dto.lessonId, orgId);
    }

    const patch: Partial<typeof scheduleEvents.$inferInsert> = {
      updatedAt: new Date(),
    };
    if (dto.title !== undefined) patch.title = dto.title;
    if (dto.type !== undefined) patch.type = dto.type;
    if (dto.startsAt !== undefined) patch.startsAt = new Date(dto.startsAt);
    if (dto.endsAt !== undefined) {
      patch.endsAt = dto.endsAt ? new Date(dto.endsAt) : null;
    }
    if (dto.description !== undefined) patch.description = dto.description;
    if (dto.location !== undefined) patch.location = dto.location;
    if (dto.meetingUrl !== undefined) patch.meetingUrl = dto.meetingUrl;
    if (dto.lessonId !== undefined) patch.lessonId = dto.lessonId;

    const [updated] = await this.db
      .update(scheduleEvents)
      .set(patch)
      .where(eq(scheduleEvents.id, id))
      .returning();
    return this.withLessonTitle(updated);
  }

  async remove(orgId: string, id: string): Promise<{ id: string }> {
    await this.assertEventInOrg(id, orgId);
    await this.db.delete(scheduleEvents).where(eq(scheduleEvents.id, id));
    return { id };
  }

  /** Resolve the linked lesson's title for a freshly written row. */
  private async withLessonTitle(row: ScheduleRow): Promise<ScheduleEventDto> {
    let lessonTitle: string | null = null;
    if (row.lessonId) {
      const [lesson] = await this.db
        .select({ title: lessons.title })
        .from(lessons)
        .where(eq(lessons.id, row.lessonId))
        .limit(1);
      lessonTitle = lesson?.title ?? null;
    }
    return toDto(row, lessonTitle, new Date());
  }

  /** Assert an event belongs to `orgId`; 404 (not 403) so ids don't leak. */
  private async assertEventInOrg(id: string, orgId: string): Promise<void> {
    const [row] = await this.db
      .select({ id: scheduleEvents.id })
      .from(scheduleEvents)
      .where(
        and(
          eq(scheduleEvents.id, id),
          eq(scheduleEvents.organizationId, orgId),
        ),
      )
      .limit(1);
    if (!row) {
      throw new NotFoundException('schedule_event_not_found');
    }
  }

  /** A timeline entry may only link to a lesson in the same org. */
  private async assertLessonInOrg(
    lessonId: string,
    orgId: string,
  ): Promise<void> {
    const [row] = await this.db
      .select({ id: lessons.id })
      .from(lessons)
      .where(and(eq(lessons.id, lessonId), eq(lessons.organizationId, orgId)))
      .limit(1);
    if (!row) {
      throw new NotFoundException('lesson_not_found');
    }
  }
}

/** Row → DTO, deriving `state` from the clock rather than storing it. */
function toDto(
  row: ScheduleRow,
  lessonTitle: string | null,
  now: Date,
): ScheduleEventDto {
  return {
    id: row.id,
    title: row.title,
    type: row.type,
    startsAt: row.startsAt.toISOString(),
    endsAt: row.endsAt ? row.endsAt.toISOString() : null,
    description: row.description,
    location: row.location,
    meetingUrl: row.meetingUrl,
    lessonId: row.lessonId,
    lessonTitle,
    state: resolveState(row, now),
  };
}

/**
 * `today` wins over `past`/`upcoming` for anything happening on the current
 * calendar day, which is what makes "сегодня" on the timeline match what the
 * student sees on their own wall clock rather than an exact-instant comparison.
 */
function resolveState(row: ScheduleRow, now: Date): ScheduleEventState {
  if (isSameDay(row.startsAt, now)) return 'today';
  const finished = (row.endsAt ?? row.startsAt).getTime() < now.getTime();
  return finished ? 'past' : 'upcoming';
}

function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}
