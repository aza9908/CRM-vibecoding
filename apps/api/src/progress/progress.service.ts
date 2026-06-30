import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import type { LessonProgressView } from '@lms/shared';

import { DRIZZLE, type Db } from '../db/db.module';
import { lessons, userProgress } from '../db/schema';
import { ActivityService } from './activity.service';

/**
 * Persists the per-lesson progress *summary* for an authenticated student
 * (docs/08 §5). Block-level progress lives on the client in real time; this is
 * the durable roll-up used for curriculum check-marks and analytics.
 *
 * The DB `progress_status` enum is 2-valued ('started' | 'completed'); the view
 * layer maps no-row → not_started, 'started' → in_progress, 'completed' →
 * completed (see {@link CurriculumService} and `LessonProgressView`).
 *
 * Tenant isolation: the caller's org is taken from the lesson's
 * `organizationId` after asserting the lesson belongs to the student's org, so
 * a cross-tenant lessonId resolves to 404 and the activity row is written under
 * the right org.
 */
@Injectable()
export class ProgressService {
  constructor(
    @Inject(DRIZZLE) private readonly db: Db,
    private readonly activity: ActivityService,
  ) {}

  /**
   * Upsert the lesson-summary progress for `userId` on `lessonId`.
   *
   *  - asserts the lesson is in `orgId` (404 otherwise — see controller);
   *  - sets progressPercent + lastAccessedAt=now();
   *  - status = percent >= 100 ? 'completed' : 'started';
   *  - completedAt = now() on reaching completion, otherwise left untouched
   *    (an already-completed row keeps its original completedAt);
   *  - writes a `lesson_started` activity row on the first touch / transition
   *    into in-progress, and a `lesson_completed` row on first reaching 100.
   */
  async upsert(
    orgId: string,
    userId: string,
    lessonId: string,
    percent: number,
  ): Promise<LessonProgressView> {
    const now = new Date();
    const completed = percent >= 100;
    const status = completed ? 'completed' : 'started';

    // Read the prior row to decide which (if any) activity events to emit.
    const [prior] = await this.db
      .select({
        status: userProgress.status,
        completedAt: userProgress.completedAt,
      })
      .from(userProgress)
      .where(
        and(
          eq(userProgress.userId, userId),
          eq(userProgress.lessonId, lessonId),
        ),
      )
      .limit(1);

    const [row] = await this.db
      .insert(userProgress)
      .values({
        userId,
        lessonId,
        progressPercent: percent,
        status,
        lastAccessedAt: now,
        completedAt: completed ? now : null,
      })
      .onConflictDoUpdate({
        target: [userProgress.userId, userProgress.lessonId],
        set: {
          progressPercent: percent,
          status,
          lastAccessedAt: now,
          // Stamp completedAt on first completion; otherwise keep whatever was
          // there (don't clear a prior completion if percent dips, and don't
          // overwrite the original completion timestamp).
          completedAt: completed
            ? (prior?.completedAt ?? now)
            : (prior?.completedAt ?? null),
        },
      })
      .returning();

    // first touch (no prior row) OR transitioning into in-progress.
    if (!prior) {
      await this.activity.writeLog({
        orgId,
        userId,
        action: 'lesson_started',
        lessonId,
      });
    }
    // first time reaching completion.
    if (completed && prior?.status !== 'completed') {
      await this.activity.writeLog({
        orgId,
        userId,
        action: 'lesson_completed',
        lessonId,
      });
    }

    return this.toView(row);
  }

  /** Map a `user_progress` row to the UI view shape. */
  private toView(row: typeof userProgress.$inferSelect): LessonProgressView {
    return {
      lessonId: row.lessonId ?? '',
      status: row.status === 'completed' ? 'completed' : 'in_progress',
      progressPercent: row.progressPercent,
      lastAccessedAt: row.lastAccessedAt
        ? row.lastAccessedAt.toISOString()
        : null,
      completedAt: row.completedAt ? row.completedAt.toISOString() : null,
    };
  }

  /**
   * Assert a lesson exists and belongs to `orgId`; returns its `organizationId`.
   * Throws 404 (not 403) so other tenants' lessons are never leaked. Mirrors
   * `LessonsService.assertLessonInOrg` but kept local to avoid a cross-module
   * dependency on the lessons feature.
   */
  async assertLessonOrg(lessonId: string, orgId: string): Promise<string> {
    const [row] = await this.db
      .select({ organizationId: lessons.organizationId })
      .from(lessons)
      .where(and(eq(lessons.id, lessonId), eq(lessons.organizationId, orgId)))
      .limit(1);

    if (!row || !row.organizationId) {
      throw new NotFoundException('lesson_not_found');
    }
    return row.organizationId;
  }
}
