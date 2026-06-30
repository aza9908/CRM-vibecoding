import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, eq, sql } from 'drizzle-orm';
import type {
  CompanyStats,
  CompanyUserDetail,
  LessonProgressViewStatus,
} from '@lms/shared';

import { DRIZZLE, type Db } from '../db/db.module';
import { lessons, userProgress, users } from '../db/schema';

/** Activity older than this many days marks an employee `inactive` (docs/09 §6). */
const INACTIVITY_DAYS = 30;
const DAY_MS = 86_400_000;

/**
 * Raw shape of the single-row company-stats aggregate query. Declared as a
 * `type` with an index signature so it satisfies `db.execute`'s
 * `QueryResultRow` constraint (`Record<string, unknown>`). Postgres returns
 * `count(*)` as a string (bigint) and `round(avg(...))` as a numeric string.
 */
type CompanyStatsRow = {
  total_students: string | number | null;
  active_30d: string | number | null;
  avg_progress: string | number | null;
  completed_lessons: string | number | null;
  [key: string]: unknown;
};

const num = (v: string | number | null): number => {
  if (v == null) return 0;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
};

/**
 * Company / organization analytics (docs/09 §6).
 *
 * Everything is scoped to a single `orgId` — the caller's organization, taken
 * from their JWT, never from input. Heavy aggregates use raw `sql` via
 * `db.execute` (a single round-trip with sub-selects) rather than several
 * Drizzle queries.
 *
 * NOTE on caching: docs/09 §8 suggests caching company stats in Redis (~10
 * min). This codebase has no injectable Redis client in the Nest DI container
 * (ioredis is constructed manually inside the Socket.IO adapter only), so
 * caching is intentionally skipped here — see the task notes.
 */
@Injectable()
export class AnalyticsService {
  constructor(@Inject(DRIZZLE) private readonly db: Db) {}

  /**
   * `GET /analytics/company` — the organization dashboard summary:
   *  - totalStudents:    users with role='student' in the org;
   *  - active30d:        distinct users with an activity_logs row in the last 30d;
   *  - avgProgress:      avg(user_progress.progress_percent) over the org's students;
   *  - completedLessons: user_progress rows with status='completed' for org students.
   *
   * All four are computed in one query as scalar sub-selects, every one scoped
   * by `organization_id = orgId`.
   */
  async companyStats(orgId: string): Promise<CompanyStats> {
    const since = new Date(Date.now() - INACTIVITY_DAYS * DAY_MS);

    const result = await this.db.execute<CompanyStatsRow>(sql`
      SELECT
        (SELECT count(*) FROM users
           WHERE organization_id = ${orgId} AND role = 'student'
        ) AS total_students,
        (SELECT count(DISTINCT user_id) FROM activity_logs
           WHERE organization_id = ${orgId} AND created_at > ${since}
        ) AS active_30d,
        (SELECT coalesce(round(avg(lp.progress_percent), 1), 0)
           FROM user_progress lp
           JOIN users u ON u.id = lp.user_id
           WHERE u.organization_id = ${orgId} AND u.role = 'student'
        ) AS avg_progress,
        (SELECT count(*)
           FROM user_progress lp
           JOIN users u ON u.id = lp.user_id
           WHERE u.organization_id = ${orgId}
             AND u.role = 'student'
             AND lp.status = 'completed'
        ) AS completed_lessons
    `);

    const row = result.rows[0];
    return {
      totalStudents: num(row?.total_students ?? 0),
      active30d: num(row?.active_30d ?? 0),
      avgProgress: num(row?.avg_progress ?? 0),
      completedLessons: num(row?.completed_lessons ?? 0),
    };
  }

  /**
   * `GET /analytics/company/users/:userId` — drilldown for one employee in the
   * caller's org: their per-lesson progress (joined with lesson titles), an
   * overall average percent, and an active/inactive/completed status.
   *
   * Scoped: the target user MUST belong to `orgId` (404 otherwise — never leak
   * that a user exists in another tenant). Only lessons that also belong to the
   * org are joined, so a cross-tenant lesson can never surface here.
   */
  async companyUserDetail(
    orgId: string,
    userId: string,
  ): Promise<CompanyUserDetail> {
    const [target] = await this.db
      .select({
        id: users.id,
        fullName: users.fullName,
        email: users.email,
      })
      .from(users)
      .where(and(eq(users.id, userId), eq(users.organizationId, orgId)))
      .limit(1);

    if (!target) throw new NotFoundException('user_not_found');

    const rows = await this.db
      .select({
        lessonId: lessons.id,
        title: lessons.title,
        status: userProgress.status,
        progressPercent: userProgress.progressPercent,
        completedAt: userProgress.completedAt,
        lastAccessedAt: userProgress.lastAccessedAt,
      })
      .from(userProgress)
      .innerJoin(lessons, eq(lessons.id, userProgress.lessonId))
      .where(
        and(
          eq(userProgress.userId, userId),
          eq(lessons.organizationId, orgId),
        ),
      );

    const lessonsView = rows.map((r) => ({
      lessonId: r.lessonId,
      title: r.title,
      status: (r.status === 'completed'
        ? 'completed'
        : 'in_progress') as LessonProgressViewStatus,
      progressPercent: r.progressPercent,
      completedAt: r.completedAt ? r.completedAt.toISOString() : null,
      lastAccessedAt: r.lastAccessedAt
        ? r.lastAccessedAt.toISOString()
        : null,
    }));

    const avgProgress = lessonsView.length
      ? Math.round(
          (lessonsView.reduce((s, l) => s + l.progressPercent, 0) /
            lessonsView.length) *
            10,
        ) / 10
      : 0;

    return {
      user: {
        id: target.id,
        fullName: target.fullName,
        email: target.email,
      },
      status: this.deriveStatus(rows),
      avgProgress,
      lessons: lessonsView,
    };
  }

  /**
   * Derive an employee status from their progress rows (docs/09 §6):
   *  - completed — they have progress and ALL of it is status='completed';
   *  - inactive  — their most recent activity is older than 30 days
   *                (or they have no progress at all);
   *  - active    — otherwise.
   */
  private deriveStatus(
    rows: Array<{
      status: 'started' | 'completed';
      lastAccessedAt: Date | null;
    }>,
  ): 'active' | 'inactive' | 'completed' {
    if (rows.length === 0) return 'inactive';

    if (rows.every((r) => r.status === 'completed')) return 'completed';

    const lastAccess = rows
      .map((r) => r.lastAccessedAt?.getTime() ?? 0)
      .reduce((max, t) => Math.max(max, t), 0);
    const cutoff = Date.now() - INACTIVITY_DAYS * DAY_MS;

    return lastAccess < cutoff ? 'inactive' : 'active';
  }
}
