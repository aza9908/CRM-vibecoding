import { Inject, Injectable } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';

import { DRIZZLE, type Db } from '../db/db.module';
import { lessonNotes } from '../db/schema';

/**
 * Per-(user, lesson) free-form notes (docs/08 — Notes tab, auto-saved).
 *
 * One row per (userId, lessonId), enforced by `notes_user_lesson_idx`; saving
 * upserts on that pair. Tenant isolation is enforced by the controller
 * asserting the lesson belongs to the caller's org before calling these
 * methods, so the notes table itself only needs the (user, lesson) scope.
 */
@Injectable()
export class NotesService {
  constructor(@Inject(DRIZZLE) private readonly db: Db) {}

  /** Return the note content for (userId, lessonId), or '' if none exists. */
  async getContent(userId: string, lessonId: string): Promise<string> {
    const [row] = await this.db
      .select({ content: lessonNotes.content })
      .from(lessonNotes)
      .where(
        and(
          eq(lessonNotes.userId, userId),
          eq(lessonNotes.lessonId, lessonId),
        ),
      )
      .limit(1);

    return row?.content ?? '';
  }

  /** Upsert the note for (userId, lessonId); returns the saved content. */
  async save(
    userId: string,
    lessonId: string,
    content: string,
  ): Promise<{ content: string }> {
    const now = new Date();
    const [row] = await this.db
      .insert(lessonNotes)
      .values({ userId, lessonId, content, updatedAt: now })
      .onConflictDoUpdate({
        target: [lessonNotes.userId, lessonNotes.lessonId],
        set: { content, updatedAt: now },
      })
      .returning({ content: lessonNotes.content });

    return { content: row.content };
  }
}
