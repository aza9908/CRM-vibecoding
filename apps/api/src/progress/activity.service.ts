import { Inject, Injectable } from '@nestjs/common';

import { DRIZZLE, type Db } from '../db/db.module';
import { activityLogs } from '../db/schema';

/**
 * Known activity-log action verbs. Kept as a string union (the DB column is a
 * free-form `text`, see docs/09) so other modules can record their own events
 * without a migration. New verbs should be added here for type-safety at the
 * call site rather than passing arbitrary strings.
 */
export type ActivityAction =
  | 'lesson_started'
  | 'lesson_completed'
  | 'session_join';

/** Arguments for {@link ActivityService.writeLog}. */
export interface WriteLogArgs {
  orgId: string;
  userId: string;
  action: ActivityAction;
  lessonId?: string | null;
  metadata?: Record<string, unknown> | null;
}

/**
 * Append-only writer for the `activity_logs` table (docs/09 — analytics).
 *
 * This is the single funnel for analytics events so the row shape and tenant
 * scoping stay consistent. It is provided + exported by `ProgressModule` and
 * reused by other modules (e.g. the sessions flow records `session_join` here
 * for authenticated participants). Best-effort by contract: callers should not
 * let an analytics write fail the user-facing operation, but this method itself
 * does not swallow errors — wrap the call if the event is non-critical.
 *
 * `orgId` always comes from the owning resource (the lesson's `organizationId`
 * or the session's org), never from untrusted input, so every row is correctly
 * tenant-scoped.
 */
@Injectable()
export class ActivityService {
  constructor(@Inject(DRIZZLE) private readonly db: Db) {}

  async writeLog(args: WriteLogArgs): Promise<void> {
    await this.db.insert(activityLogs).values({
      organizationId: args.orgId,
      userId: args.userId,
      action: args.action,
      lessonId: args.lessonId ?? null,
      metadata: args.metadata ?? null,
    });
  }
}
