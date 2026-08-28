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

    // Every lesson owned by this org, not just ones already attached to a
    // module — the editor creates module-less lessons by default (see the
    // comment on `lessons.organizationId` in schema.ts), so scoping this
    // query through `moduleIds` would silently hide most real content.
    // Module-less lessons are bucketed into a synthetic "unassigned" module
    // below instead of being dropped.
    const lessonRows = await this.db
      .select({
        id: lessons.id,
        moduleId: lessons.moduleId,
        title: lessons.title,
        type: lessons.type,
        kind: lessons.kind,
        order: lessons.order,
        scheduledAt: lessons.scheduledAt,
        createdAt: lessons.createdAt,
      })
      .from(lessons)
      .where(eq(lessons.organizationId, orgId))
      // `order` defaults to 0 for every lesson until a teacher explicitly
      // drags one to reorder it, so most lessons tie on `order` — without a
      // tiebreaker Postgres doesn't guarantee which one comes first, and the
      // student-facing "Мои уроки"/timeline list can render lessons out of
      // sequence (0, 1, 2, ...) on any given fetch. `createdAt` matches the
      // creation order, same tiebreaker `LessonsService.list` already uses.
      // (The additional "kind='intro' always first" rule from TZ §6.2.1 is
      // applied only in `curriculumForStudent`, not here — this same query
      // also backs the teacher's own drag-and-drop reorder UI, and pinning
      // it here would make that UI silently snap the intro lesson back to
      // the front on every refetch, including when a teacher deliberately
      // reorders lessons around it.)
      .orderBy(asc(lessons.order), asc(lessons.createdAt));

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

    /** Synthetic module id for lessons with no real `moduleId`. Never sent
     * to `/program/modules/*` — the client must not render edit/delete
     * controls for it, only for real (UUID) module rows. */
    const UNASSIGNED_MODULE_ID = 'unassigned';

    const lessonsByModule = new Map<string, CurriculumLesson[]>();
    for (const l of lessonRows) {
      const lesson: CurriculumLesson = {
        id: l.id,
        title: l.title,
        type: l.type,
        kind: l.kind,
        order: l.order,
        scheduledAt: l.scheduledAt ? l.scheduledAt.toISOString() : null,
        outcomes: outcomesByLesson.get(l.id) ?? [],
      };
      const bucketId = l.moduleId ?? UNASSIGNED_MODULE_ID;
      const list = lessonsByModule.get(bucketId) ?? [];
      list.push(lesson);
      lessonsByModule.set(bucketId, list);
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

    const unassignedLessons = lessonsByModule.get(UNASSIGNED_MODULE_ID) ?? [];
    if (unassignedLessons.length > 0) {
      modulesTree.push({
        id: UNASSIGNED_MODULE_ID,
        code: null,
        title: 'Без раздела',
        order: Number.MAX_SAFE_INTEGER,
        lessons: unassignedLessons,
        progressPercent: 0,
      });
    }

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

        // "Урок 0" (kind='intro') is always the first card for a student —
        // TZ_LMS_roles_promocodes.md §6.2.1 — regardless of its `order`
        // value, since some orgs have older lessons still sitting at the
        // same default `order=0`. A stable sort only moves intro lessons to
        // the front; everything else keeps the order the query returned.
        // Applied here (student view only), not in `getCurriculumTree`
        // itself, so the teacher's own drag-and-drop reorder UI — which
        // reads the same tree — isn't fighting a forced re-sort on refetch.
        lessons.sort((a, b) => (a.kind === 'intro' ? 0 : 1) - (b.kind === 'intro' ? 0 : 1));

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
