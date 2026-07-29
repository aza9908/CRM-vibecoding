/**
 * Seed the Day-1 "Вайб-кодинг с Claude" workbook into the database.
 *
 * Idempotent: re-running replaces the lesson's blocks with the current
 * `DAY1_WORKBOOK` (delete-all-then-insert), and reuses the course / module /
 * lesson rows if they already exist (matched by title within the org).
 *
 * Usage (from repo root, DATABASE_URL must be set):
 *   npm run seed:workbook --workspace=@lms/api
 *
 * Target org resolution, in priority order:
 *   1. SEED_ORG_ID           — explicit organization id
 *   2. SEED_TEACHER_EMAIL    — org of that user (also set as lesson teacher)
 *   3. first organization row (single-tenant / dev convenience)
 */
// Optional local .env loading; a no-op if dotenv isn't installed / no .env.
try { require('dotenv').config(); } catch { /* env already provided */ }
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { and, asc, eq } from 'drizzle-orm';

import { schema } from './schema';
import {
  courses,
  lessonBlocks,
  lessons,
  modules,
  organizations,
  users,
} from './schema';
import { DAY1_WORKBOOK, DAY1_STATS } from './workbook-day1';

const COURSE_TITLE = 'Вайб-кодинг с Claude';
const MODULE_TITLE = 'День 1 · От слов к прототипу';
const LESSON_TITLE = 'День 1 — От слов к прототипу';

async function main(): Promise<void> {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error('DATABASE_URL is not set');

  const pool = new Pool({ connectionString });
  const db = drizzle(pool, { schema });

  try {
    // 1. Resolve organization + optional teacher.
    let orgId = process.env.SEED_ORG_ID ?? null;
    let teacherId: string | null = null;

    if (!orgId && process.env.SEED_TEACHER_EMAIL) {
      const teacher = await db.query.users.findFirst({
        where: eq(users.email, process.env.SEED_TEACHER_EMAIL),
      });
      if (!teacher) {
        throw new Error(
          `No user with SEED_TEACHER_EMAIL=${process.env.SEED_TEACHER_EMAIL}`,
        );
      }
      orgId = teacher.organizationId;
      teacherId = teacher.id;
    }

    if (!orgId) {
      const firstOrg = await db.query.organizations.findFirst({
        orderBy: asc(organizations.createdAt),
      });
      if (!firstOrg) {
        throw new Error(
          'No organizations found — register a user first, then re-run.',
        );
      }
      orgId = firstOrg.id;
    }

    console.log(`→ org: ${orgId}${teacherId ? ` · teacher: ${teacherId}` : ''}`);

    // 2. Ensure course.
    let course = await db.query.courses.findFirst({
      where: and(
        eq(courses.organizationId, orgId),
        eq(courses.title, COURSE_TITLE),
      ),
    });
    if (!course) {
      [course] = await db
        .insert(courses)
        .values({ organizationId: orgId, title: COURSE_TITLE })
        .returning();
      console.log('  + created course');
    }

    // 3. Ensure module.
    let mod = await db.query.modules.findFirst({
      where: and(eq(modules.courseId, course.id), eq(modules.title, MODULE_TITLE)),
    });
    if (!mod) {
      [mod] = await db
        .insert(modules)
        .values({
          courseId: course.id,
          title: MODULE_TITLE,
          code: 'M1',
          order: 0,
        })
        .returning();
      console.log('  + created module');
    }

    // 4. Ensure lesson.
    let lesson = await db.query.lessons.findFirst({
      where: and(
        eq(lessons.organizationId, orgId),
        eq(lessons.title, LESSON_TITLE),
      ),
    });
    if (!lesson) {
      [lesson] = await db
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
      console.log('  + created lesson');
    } else if (teacherId && lesson.teacherId !== teacherId) {
      await db
        .update(lessons)
        .set({ teacherId, moduleId: mod.id })
        .where(eq(lessons.id, lesson.id));
    }

    // 5. Replace blocks (delete-all-then-insert with order = array index).
    await db.delete(lessonBlocks).where(eq(lessonBlocks.lessonId, lesson.id));

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

    // Chunked insert keeps the statement well under parameter limits.
    for (let i = 0; i < rows.length; i += 50) {
      await db.insert(lessonBlocks).values(rows.slice(i, i + 50));
    }

    console.log(
      `✓ seeded lesson "${LESSON_TITLE}" (${lesson.id}) with ${rows.length} blocks`,
    );
    console.log(
      `  stats: ${DAY1_STATS.images} slides · ${DAY1_STATS.inputs} interactive · ` +
        `${DAY1_STATS.tasks} tasks · ${DAY1_STATS.breaks} breaks`,
    );
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error('✗ seed failed:', err);
  process.exit(1);
});
