import { Inject, Injectable } from '@nestjs/common';
import { asc, eq, inArray } from 'drizzle-orm';
import type {
  CurriculumLesson,
  CurriculumModule,
  CurriculumTree,
  ProgressStatus,
} from '@lms/shared';

import { DRIZZLE, type Db } from '../db/db.module';
import {
  courses,
  lessonOutcomes,
  lessons,
  modules,
  userProgress,
} from '../db/schema';

/**
 * Builds the program-of-study tree (course -> modules -> lessons -> outcomes)
 * for an organization, and the student-flavoured variant with per-lesson
 * progress merged in.
 *
 * Everything is scoped to `orgId`: the tree is anchored on the first course of
 * the organization (the MVP assumes a single course per org — see docs/03 §5).
 */
@Injectable()
export class CurriculumService {
  constructor(@Inject(DRIZZLE) private readonly db: Db) {}

  /** Full curriculum tree for `orgId` (teacher / generic view, no progress). */
  async getCurriculumTree(orgId: string): Promise<CurriculumTree> {
    const [course] = await this.db
      .select({ id: courses.id, title: courses.title })
      .from(courses)
      .where(eq(courses.organizationId, orgId))
      .orderBy(asc(courses.createdAt))
      .limit(1);

    if (!course) {
      return { course: null, modules: [] };
    }

    const moduleRows = await this.db
      .select({
        id: modules.id,
        code: modules.code,
        title: modules.title,
        order: modules.order,
      })
      .from(modules)
      .where(eq(modules.courseId, course.id))
      .orderBy(asc(modules.order));

    const moduleIds = moduleRows.map((m) => m.id);

    // Lessons across all modules of this course, ordered for stable rendering.
    const lessonRows = moduleIds.length
      ? await this.db
          .select({
            id: lessons.id,
            moduleId: lessons.moduleId,
            title: lessons.title,
            type: lessons.type,
            order: lessons.order,
          })
          .from(lessons)
          .where(inArray(lessons.moduleId, moduleIds))
          .orderBy(asc(lessons.order))
      : [];

    const lessonIds = lessonRows.map((l) => l.id);

    // Outcomes for all those lessons in one query, grouped by lessonId.
    const outcomeRows = lessonIds.length
      ? await this.db
          .select({
            id: lessonOutcomes.id,
            lessonId: lessonOutcomes.lessonId,
            title: lessonOutcomes.title,
          })
          .from(lessonOutcomes)
          .where(inArray(lessonOutcomes.lessonId, lessonIds))
      : [];

    const outcomesByLesson = new Map<string, { id: string; title: string }[]>();
    for (const o of outcomeRows) {
      if (!o.lessonId) continue;
      const list = outcomesByLesson.get(o.lessonId) ?? [];
      list.push({ id: o.id, title: o.title });
      outcomesByLesson.set(o.lessonId, list);
    }

    const lessonsByModule = new Map<string, CurriculumLesson[]>();
    for (const l of lessonRows) {
      if (!l.moduleId) continue;
      const lesson: CurriculumLesson = {
        id: l.id,
        title: l.title,
        type: l.type,
        order: l.order,
        outcomes: outcomesByLesson.get(l.id) ?? [],
      };
      const list = lessonsByModule.get(l.moduleId) ?? [];
      list.push(lesson);
      lessonsByModule.set(l.moduleId, list);
    }

    const modulesTree: CurriculumModule[] = moduleRows.map((m) => ({
      id: m.id,
      code: m.code,
      title: m.title,
      order: m.order,
      lessons: lessonsByModule.get(m.id) ?? [],
      // Teacher / generic view carries no progress; the student variant
      // overwrites this with the real per-module average.
      progressPercent: 0,
    }));

    return { course: { id: course.id, title: course.title }, modules: modulesTree };
  }

  /**
   * Curriculum tree with the student's per-lesson progress merged in, plus a
   * per-module average percent.
   *
   * For each lesson we merge:
   *   - `progressStatus`: the stored DB status ('started' | 'completed'),
   *     absent when no row exists (the UI reads absence as not_started);
   *   - `progressPercent`: the stored 0–100 percent (0 when no row exists).
   *
   * The module `progressPercent` is the simple average of its lessons'
   * percents (rounded), counting lessons with no progress row as 0. A module
   * with no lessons stays at 0. Progress is fetched once for `userId` and
   * joined in memory by lessonId.
   */
  async curriculumForStudent(
    orgId: string,
    userId: string,
  ): Promise<CurriculumTree> {
    const tree = await this.getCurriculumTree(orgId);

    const progressRows = await this.db
      .select({
        lessonId: userProgress.lessonId,
        status: userProgress.status,
        progressPercent: userProgress.progressPercent,
      })
      .from(userProgress)
      .where(eq(userProgress.userId, userId));

    const progressByLesson = new Map<
      string,
      { status: ProgressStatus; progressPercent: number }
    >();
    for (const p of progressRows) {
      if (p.lessonId) {
        progressByLesson.set(p.lessonId, {
          status: p.status,
          progressPercent: p.progressPercent,
        });
      }
    }

    return {
      ...tree,
      modules: tree.modules.map((m) => {
        const lessons = m.lessons.map((l) => {
          const p = progressByLesson.get(l.id);
          // No row → not_started: omit progressStatus, percent defaults to 0.
          return {
            ...l,
            ...(p ? { progressStatus: p.status } : {}),
            progressPercent: p?.progressPercent ?? 0,
          } satisfies CurriculumLesson;
        });

        // Module percent = average of its lessons' percents (0 when empty).
        const moduleProgress = lessons.length
          ? Math.round(
              lessons.reduce((sum, l) => sum + (l.progressPercent ?? 0), 0) /
                lessons.length,
            )
          : 0;

        return { ...m, lessons, progressPercent: moduleProgress };
      }),
    };
  }
}
