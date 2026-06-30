import {
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { and, asc, eq } from 'drizzle-orm';
import type {
  CreateLessonDto,
  LessonType,
  UpdateLessonDto,
} from '@lms/shared';

import { DRIZZLE, type Db } from '../db/db.module';
import {
  courses,
  lessonOutcomes,
  lessons,
  modules,
} from '../db/schema';
import { BlocksService } from './blocks.service';

/**
 * A lesson row enriched with its module/course chain — used to enforce
 * tenant isolation, since `lessons` has no direct `organization_id` column.
 * Ownership is derived through `lesson -> module -> course -> organization`.
 */
type LessonRow = typeof lessons.$inferSelect;

/**
 * CRUD for lessons, scoped to the caller's organization.
 *
 * Multi-tenant isolation is application-level (no RLS). Lessons have no
 * `organization_id` of their own, so every read/write asserts the lesson
 * belongs to `orgId` by joining through `modules -> courses`. Lessons whose
 * `moduleId` is null (orphans, e.g. after a module was deleted) are treated as
 * belonging to no organization and are therefore invisible to every tenant —
 * which is the safe default.
 */
@Injectable()
export class LessonsService {
  constructor(
    @Inject(DRIZZLE) private readonly db: Db,
    private readonly blocks: BlocksService,
  ) {}

  /** List all lessons that belong to `orgId`. */
  async list(orgId: string): Promise<LessonRow[]> {
    return this.db
      .select()
      .from(lessons)
      .where(eq(lessons.organizationId, orgId))
      .orderBy(asc(lessons.order), asc(lessons.createdAt));
  }

  /** Create a lesson owned (transitively) by `orgId`, authored by `teacherId`. */
  async create(
    orgId: string,
    teacherId: string,
    dto: CreateLessonDto,
  ): Promise<LessonRow> {
    if (dto.moduleId) {
      await this.assertModuleInOrg(dto.moduleId, orgId);
    }

    const [lesson] = await this.db
      .insert(lessons)
      .values({
        organizationId: orgId,
        title: dto.title,
        type: (dto.type ?? 'stream') as LessonType,
        moduleId: dto.moduleId ?? null,
        teacherId,
      })
      .returning();

    return lesson;
  }

  /** Return a lesson with its blocks and outcomes, scoped to `orgId`. */
  async getWithContent(orgId: string, lessonId: string) {
    const lesson = await this.assertLessonInOrg(lessonId, orgId);

    const [blocks, outcomes] = await Promise.all([
      this.blocks.getBlocks(lessonId),
      this.db
        .select()
        .from(lessonOutcomes)
        .where(eq(lessonOutcomes.lessonId, lessonId)),
    ]);

    return { ...lesson, blocks, outcomes };
  }

  /** Rename / move a lesson; tenant-scoped. */
  async update(
    orgId: string,
    lessonId: string,
    dto: UpdateLessonDto,
  ): Promise<LessonRow> {
    const current = await this.assertLessonInOrg(lessonId, orgId);

    // A move into a new module must stay inside the same organization.
    if (dto.moduleId) {
      await this.assertModuleInOrg(dto.moduleId, orgId);
    }

    const patch: Partial<typeof lessons.$inferInsert> = {};
    if (dto.title !== undefined) patch.title = dto.title;
    if (dto.type !== undefined) patch.type = dto.type;
    if (dto.moduleId !== undefined) patch.moduleId = dto.moduleId;

    if (Object.keys(patch).length === 0) {
      // Nothing to change — return the current row.
      return current;
    }

    const [updated] = await this.db
      .update(lessons)
      .set(patch)
      .where(eq(lessons.id, lessonId))
      .returning();

    return updated;
  }

  /** Delete a lesson; tenant-scoped. Cascades to blocks/outcomes via FKs. */
  async remove(orgId: string, lessonId: string): Promise<{ id: string }> {
    await this.assertLessonInOrg(lessonId, orgId);
    await this.db.delete(lessons).where(eq(lessons.id, lessonId));
    return { id: lessonId };
  }

  /**
   * Assert a lesson exists and belongs to `orgId`; returns the lesson row.
   * Throws 404 (not 403) so existence of other tenants' lessons is not leaked.
   */
  async assertLessonInOrg(
    lessonId: string,
    orgId: string,
  ): Promise<LessonRow> {
    const [lesson] = await this.db
      .select()
      .from(lessons)
      .where(and(eq(lessons.id, lessonId), eq(lessons.organizationId, orgId)))
      .limit(1);

    if (!lesson) {
      throw new NotFoundException('lesson_not_found');
    }
    return lesson;
  }

  /** Assert a module belongs to `orgId` (used when creating/moving lessons). */
  private async assertModuleInOrg(
    moduleId: string,
    orgId: string,
  ): Promise<void> {
    const [row] = await this.db
      .select({ id: modules.id })
      .from(modules)
      .innerJoin(courses, eq(courses.id, modules.courseId))
      .where(and(eq(modules.id, moduleId), eq(courses.organizationId, orgId)))
      .limit(1);

    if (!row) {
      throw new NotFoundException('module_not_found');
    }
  }
}
