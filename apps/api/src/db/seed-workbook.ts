/**
 * Seed the Day-1 "Вайб-кодинг с Claude" workbook into the database.
 *
 * Usage (from repo root, DATABASE_URL must be set):
 *   npm run seed:workbook --workspace=@lms/api
 *
 * Target org resolution, in priority order:
 *   1. SEED_ORG_ID           — explicit organization id
 *   2. SEED_TEACHER_EMAIL    — org of that user (also set as lesson teacher)
 *   3. first organization row (single-tenant / dev convenience)
 *
 * Prefer `POST /admin/workbook/seed` on a live API when you don't have
 * direct DB access — same logic, admin JWT required.
 */
try {
  require('dotenv').config();
} catch {
  /* env already provided */
}
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';

import { schema } from './schema';
import { WorkbookSeedService } from './workbook-seed.service';

async function main(): Promise<void> {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error('DATABASE_URL is not set');

  const pool = new Pool({ connectionString });
  const db = drizzle(pool, { schema });
  // Minimal DI stand-in for the Nest service.
  const seeder = new WorkbookSeedService(db as never);

  try {
    const result = await seeder.seed({
      orgId: process.env.SEED_ORG_ID ?? null,
      teacherEmail: process.env.SEED_TEACHER_EMAIL ?? null,
    });
    console.log(
      `✓ seeded lesson ${result.lessonId} with ${result.blocks} blocks ` +
        `(${result.stats.images} slides · ${result.stats.inputs} interactive · ` +
        `${result.stats.tasks} tasks · ${result.stats.breaks} breaks)`,
    );
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error('✗ seed failed:', err);
  process.exit(1);
});
