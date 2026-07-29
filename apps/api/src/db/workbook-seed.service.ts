import { Inject, Injectable, Logger } from '@nestjs/common';
import { and, asc, eq, sql } from 'drizzle-orm';

import { DRIZZLE, type Db } from './db.module';
import {
  courses,
  lessonBlocks,
  lessons,
  modules,
  organizations,
  users,
} from './schema';
import { DAY1_STATS, DAY1_WORKBOOK } from './workbook-day1';

const COURSE_TITLE = 'Вайб-кодинг с Claude';
const MODULE_TITLE = 'День 1 · От слов к прототипу';
const LESSON_TITLE = 'День 1 — От слов к прототипу';

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
      [course] = await this.db
        .insert(courses)
        .values({ organizationId: orgId, title: COURSE_TITLE })
        .returning();
    }

    let mod = await this.db.query.modules.findFirst({
      where: and(eq(modules.courseId, course.id), eq(modules.title, MODULE_TITLE)),
    });
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
    } else if (teacherId && lesson.teacherId !== teacherId) {
      await this.db
        .update(lessons)
        .set({ teacherId, moduleId: mod.id })
        .where(eq(lessons.id, lesson.id));
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
}
