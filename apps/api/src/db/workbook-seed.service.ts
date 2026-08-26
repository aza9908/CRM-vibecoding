import { Inject, Injectable, Logger } from '@nestjs/common';
import { and, asc, eq, inArray, sql } from 'drizzle-orm';

import { DRIZZLE, type Db } from './db.module';
import {
  courses,
  lessonBlocks,
  lessons,
  liveSessions,
  modules,
  organizations,
  users,
} from './schema';
import { DAY1_STATS, DAY1_WORKBOOK } from './workbook-day1';

const COURSE_TITLE = 'Воркшоп: Вайб-кодинг';
/** Shown in cabinet «Прогресс по модулям». */
const MODULE_TITLE = 'Вайб-кодинг: от слов к прототипу';
const LEGACY_MODULE_TITLES = [
  'Воркшоп · Вайб-кодинг с роботами',
  'День 1 · От слов к прототипу',
] as const;
/** Display title on the Уроки list — workshop name. */
const LESSON_TITLE = 'Воркшоп: Вайб-кодинг';
/** Older titles from previous seeds — still recognized so we rename in place. */
const LEGACY_LESSON_TITLES = [
  'День 1 — Вайб-кодинг с роботами',
  'День 1 — От слов к прототипу',
  'День1_Вайб-кодинг_с_роботами',
] as const;

export type SeedWorkbookResult = {
  orgId: string;
  lessonId: string;
  blocks: number;
  stats: typeof DAY1_STATS;
};

/**
 * Idempotent Day-1 workbook seeder used by the CLI script and the admin API.
 * Re-running replaces the lesson's blocks (delete-all-then-insert).
 */
@Injectable()
export class WorkbookSeedService {
  private readonly logger = new Logger(WorkbookSeedService.name);

  constructor(@Inject(DRIZZLE) private readonly db: Db) {}

  /**
   * Ensure columns/tables that older prod DBs may lack after a code deploy
   * (App Hosting does not auto-run drizzle migrations).
   */
  async ensureSchema(): Promise<void> {
    await this.db.execute(
      sql`ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "occupation" text`,
    );
    // Backfill: older saves never set is_completed, so reports showed 0%.
    await this.db.execute(sql`
      UPDATE "responses"
      SET "is_completed" = true
      WHERE "is_completed" = false
        AND "answer_text" IS NOT NULL
        AND length(trim("answer_text")) > 0
    `);
  }

  async seed(opts: {
    orgId?: string | null;
    teacherEmail?: string | null;
  }): Promise<SeedWorkbookResult> {
    await this.ensureSchema();

    let orgId = opts.orgId ?? null;
    let teacherId: string | null = null;

    if (!orgId && opts.teacherEmail) {
      const teacher = await this.db.query.users.findFirst({
        where: eq(users.email, opts.teacherEmail),
      });
      if (!teacher) {
        throw new Error(`No user with email=${opts.teacherEmail}`);
      }
      orgId = teacher.organizationId;
      teacherId = teacher.id;
    }

    if (!orgId) {
      const firstOrg = await this.db.query.organizations.findFirst({
        orderBy: asc(organizations.createdAt),
      });
      if (!firstOrg) {
        throw new Error('No organizations found — register a user first.');
      }
      orgId = firstOrg.id;
    }

    let course = await this.db.query.courses.findFirst({
      where: and(
        eq(courses.organizationId, orgId),
        eq(courses.title, COURSE_TITLE),
      ),
    });
    if (!course) {
      course = await this.db.query.courses.findFirst({
        where: and(
          eq(courses.organizationId, orgId),
          eq(courses.title, 'Вайб-кодинг с Claude'),
        ),
      });
      if (course) {
        await this.db
          .update(courses)
          .set({ title: COURSE_TITLE })
          .where(eq(courses.id, course.id));
        course = { ...course, title: COURSE_TITLE };
      }
    }
    if (!course) {
      [course] = await this.db
        .insert(courses)
        .values({ organizationId: orgId, title: COURSE_TITLE })
        .returning();
    }

    let mod = await this.db.query.modules.findFirst({
      where: and(eq(modules.courseId, course.id), eq(modules.title, MODULE_TITLE)),
    });
    if (!mod) {
      for (const legacy of LEGACY_MODULE_TITLES) {
        mod = await this.db.query.modules.findFirst({
          where: and(eq(modules.courseId, course.id), eq(modules.title, legacy)),
        });
        if (mod) break;
      }
      if (mod) {
        await this.db
          .update(modules)
          .set({ title: MODULE_TITLE })
          .where(eq(modules.id, mod.id));
        mod = { ...mod, title: MODULE_TITLE };
      }
    }
    if (!mod) {
      [mod] = await this.db
        .insert(modules)
        .values({
          courseId: course.id,
          title: MODULE_TITLE,
          code: 'M1',
          order: 0,
        })
        .returning();
    }

    let lesson = await this.db.query.lessons.findFirst({
      where: and(
        eq(lessons.organizationId, orgId),
        eq(lessons.title, LESSON_TITLE),
      ),
    });
    if (!lesson) {
      for (const legacy of LEGACY_LESSON_TITLES) {
        lesson = await this.db.query.lessons.findFirst({
          where: and(
            eq(lessons.organizationId, orgId),
            eq(lessons.title, legacy),
          ),
        });
        if (lesson) break;
      }
    }
    // Prefer the module-linked workshop lesson even if the teacher renamed it.
    if (!lesson) {
      lesson = await this.db.query.lessons.findFirst({
        where: and(
          eq(lessons.organizationId, orgId),
          eq(lessons.moduleId, mod.id),
        ),
        orderBy: asc(lessons.order),
      });
    }
    if (!lesson) {
      [lesson] = await this.db
        .insert(lessons)
        .values({
          organizationId: orgId,
          moduleId: mod.id,
          teacherId,
          title: LESSON_TITLE,
          type: 'stream',
          order: 0,
        })
        .returning();
    } else {
      // Keep a custom title if the teacher renamed away from legacy names;
      // only force-rename when still on a known legacy/default title.
      const shouldRename =
        lesson.title === LESSON_TITLE ||
        (LEGACY_LESSON_TITLES as readonly string[]).includes(lesson.title);
      const patch: Partial<typeof lessons.$inferInsert> = {
        moduleId: mod.id,
      };
      if (shouldRename) patch.title = LESSON_TITLE;
      if (teacherId) patch.teacherId = teacherId;
      await this.db
        .update(lessons)
        .set(patch)
        .where(eq(lessons.id, lesson.id));
      lesson = {
        ...lesson,
        ...patch,
        title: shouldRename ? LESSON_TITLE : lesson.title,
      };
    }

    // Never wipe blocks while a live session is running for this lesson —
    // a mid-workshop deploy/restart would invalidate focus IDs and responses.
    const activeLive = await this.db.query.liveSessions.findFirst({
      where: and(
        eq(liveSessions.lessonId, lesson.id),
        eq(liveSessions.status, 'live'),
      ),
    });
    if (activeLive) {
      this.logger.warn(
        `Skip seed for lesson ${lesson.id}: live session ${activeLive.code} is running`,
      );
      const existing = await this.db.query.lessonBlocks.findMany({
        where: eq(lessonBlocks.lessonId, lesson.id),
      });
      return {
        orgId,
        lessonId: lesson.id,
        blocks: existing.length,
        stats: DAY1_STATS,
      };
    }

    await this.db.delete(lessonBlocks).where(eq(lessonBlocks.lessonId, lesson.id));

    const rows = DAY1_WORKBOOK.map((b, i) => ({
      lessonId: lesson!.id,
      type: b.type,
      content: b.content ?? null,
      imageUrl: b.imageUrl ?? null,
      options: (b.options ?? null) as unknown,
      orderIndex: i,
      blockRole: b.blockRole ?? null,
      generatedBy: 'manual' as const,
    }));

    for (let i = 0; i < rows.length; i += 50) {
      await this.db.insert(lessonBlocks).values(rows.slice(i, i + 50));
    }

    this.logger.log(
      `Seeded lesson "${LESSON_TITLE}" (${lesson.id}) with ${rows.length} blocks`,
    );

    return {
      orgId,
      lessonId: lesson.id,
      blocks: rows.length,
      stats: DAY1_STATS,
    };
  }

  /**
   * Seed the Day-1 workbook into every organization that has at least one
   * teacher/admin. Used on API boot so every teacher sees the workshop lesson
   * under Уроки without a manual seed call.
   */
  /** Attach a teacher to an already-seeded lesson (org-scoped ownership). */
  async assignTeacher(lessonId: string, teacherId: string): Promise<void> {
    await this.db
      .update(lessons)
      .set({ teacherId })
      .where(eq(lessons.id, lessonId));
  }

  async seedAllOrgs(): Promise<{ orgs: number; results: SeedWorkbookResult[] }> {
    await this.ensureSchema();
    const orgs = await this.db.query.organizations.findMany({
      orderBy: asc(organizations.createdAt),
    });
    const results: SeedWorkbookResult[] = [];
    for (const org of orgs) {
      const teacher = await this.db.query.users.findFirst({
        where: and(
          eq(users.organizationId, org.id),
          inArray(users.role, ['admin', 'teacher']),
        ),
        orderBy: asc(users.createdAt),
      });
      try {
        // Pass orgId explicitly; teacherEmail only used when orgId is absent.
        const result = await this.seed({ orgId: org.id });
        if (teacher) {
          await this.db
            .update(lessons)
            .set({ teacherId: teacher.id })
            .where(eq(lessons.id, result.lessonId));
        }
        results.push(result);
      } catch (err) {
        this.logger.warn(
          `seed skipped for org ${org.id}: ${(err as Error).message}`,
        );
      }
    }
    this.logger.log(`seedAllOrgs done: ${results.length}/${orgs.length} orgs`);
    return { orgs: orgs.length, results };
  }
}
