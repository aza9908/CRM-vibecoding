import {
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { and, asc, eq, notInArray, sql } from 'drizzle-orm';
import type { BlockDto } from '@lms/shared';

import { DRIZZLE, type Db } from '../db/db.module';
import { lessonBlocks, lessons } from '../db/schema';

type BlockRow = typeof lessonBlocks.$inferSelect;

/**
 * Workbook block persistence.
 *
 * `saveBlocks` mirrors the editor's "Publish": upsert the incoming blocks (with
 * order derived from array position) and delete any block that disappeared from
 * the lesson. It runs in a single transaction so a partial save can never leave
 * the workbook in a torn state.
 *
 * This service is exported from `LessonsModule` and reused by the AI module
 * (`POST /lessons/:id/blocks/generate`), so it owns its own tenant check rather
 * than delegating to `LessonsService` — that keeps the dependency graph acyclic
 * (LessonsService -> BlocksService, never the reverse).
 */
@Injectable()
export class BlocksService {
  constructor(@Inject(DRIZZLE) private readonly db: Db) {}

  /**
   * Bulk-save the blocks of a lesson.
   *
   * 1. Verifies the lesson belongs to `orgId`.
   * 2. Deletes blocks no longer present in `incoming` (orphans).
   * 3. Upserts each incoming block, setting `orderIndex` to its array index so
   *    the client's post-drag-and-drop order is authoritative.
   *
   * Returns the freshly persisted blocks ordered by `orderIndex`.
   */
  async saveBlocks(
    orgId: string,
    lessonId: string,
    incoming: BlockDto[],
  ): Promise<BlockRow[]> {
    await this.assertLessonInOrg(lessonId, orgId);

    return this.db.transaction(async (tx) => {
      const incomingIds = incoming
        .map((b) => b.id)
        .filter((id): id is string => Boolean(id));

      // 1. Delete orphaned blocks (those not present in the incoming payload).
      await tx
        .delete(lessonBlocks)
        .where(
          incomingIds.length
            ? and(
                eq(lessonBlocks.lessonId, lessonId),
                notInArray(lessonBlocks.id, incomingIds),
              )
            : eq(lessonBlocks.lessonId, lessonId),
        );

      // 2. Upsert each block; order_index comes from the array position.
      for (const [i, b] of incoming.entries()) {
        const values: typeof lessonBlocks.$inferInsert = {
          lessonId,
          type: b.type,
          content: b.content ?? null,
          imageUrl: b.imageUrl ?? null,
          options: b.options ?? null,
          orderIndex: i,
          outcomeId: b.outcomeId ?? null,
          blockRole: b.blockRole ?? null,
          generatedBy: b.generatedBy ?? 'manual',
        };
        if (b.id) {
          values.id = b.id;
        }

        await tx
          .insert(lessonBlocks)
          .values(values)
          .onConflictDoUpdate({
            target: lessonBlocks.id,
            set: {
              type: values.type,
              content: values.content,
              imageUrl: values.imageUrl,
              options: values.options,
              orderIndex: values.orderIndex,
              outcomeId: values.outcomeId,
              blockRole: values.blockRole,
              generatedBy: values.generatedBy,
            },
          });
      }

      return this.getBlocks(lessonId, tx);
    });
  }

  /** Return a lesson's blocks ordered by `orderIndex`. */
  async getBlocks(lessonId: string, db: Db = this.db): Promise<BlockRow[]> {
    return db
      .select()
      .from(lessonBlocks)
      .where(eq(lessonBlocks.lessonId, lessonId))
      .orderBy(asc(lessonBlocks.orderIndex));
  }

  /**
   * Insert new blocks after a lesson's existing ones, touching nothing
   * already there — unlike `saveBlocks`, which treats "no incoming ids" as
   * "this is the full lesson, delete anything else" (correct for the
   * editor's Publish, which always sends the complete current list; wrong
   * for a caller that only has *new* content to add, like the AI-
   * generation fallback in `AiController.generateFromFile`).
   *
   * The existing-count read and the inserts happen in one transaction, and
   * the tenant check runs before either, so this can't race a concurrent
   * edit into deleting/overwriting it (the earlier version of this fallback
   * fetched existing blocks outside a transaction, in a separate query from
   * the eventual save) and can't leak another org's block content (the
   * check runs before any read). Returns only the newly inserted rows — not
   * the lesson's full block list — matching the same "response = new
   * blocks to append" contract `AiService.generateBlocks`'s callers rely on
   * (`EditorView.onAiGenerated` appends the response onto existing editor
   * state; if this returned the whole lesson, every pre-existing block
   * would show up duplicated).
   */
  async appendBlocks(
    orgId: string,
    lessonId: string,
    newBlocks: BlockDto[],
  ): Promise<BlockRow[]> {
    await this.assertLessonInOrg(lessonId, orgId);

    return this.db.transaction(async (tx) => {
      const [{ count }] = await tx
        .select({ count: sql<number>`count(*)::int` })
        .from(lessonBlocks)
        .where(eq(lessonBlocks.lessonId, lessonId));

      const inserted: BlockRow[] = [];
      for (const [i, b] of newBlocks.entries()) {
        const [row] = await tx
          .insert(lessonBlocks)
          .values({
            lessonId,
            type: b.type,
            content: b.content ?? null,
            imageUrl: b.imageUrl ?? null,
            options: b.options ?? null,
            orderIndex: count + i,
            outcomeId: b.outcomeId ?? null,
            blockRole: b.blockRole ?? null,
            generatedBy: b.generatedBy ?? 'manual',
          })
          .returning();
        inserted.push(row);
      }
      return inserted;
    });
  }

  /**
   * Assert a lesson exists and belongs to `orgId` via its direct
   * `organization_id`. Throws 404 otherwise so the existence of other tenants'
   * lessons is never revealed.
   */
  private async assertLessonInOrg(
    lessonId: string,
    orgId: string,
  ): Promise<void> {
    const [row] = await this.db
      .select({ id: lessons.id })
      .from(lessons)
      .where(and(eq(lessons.id, lessonId), eq(lessons.organizationId, orgId)))
      .limit(1);

    if (!row) {
      throw new NotFoundException('lesson_not_found');
    }
  }
}
