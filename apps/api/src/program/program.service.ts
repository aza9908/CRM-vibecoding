import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, asc, eq, sql } from 'drizzle-orm';
import type { CreateModuleDto, UpdateModuleDto, UpsertCourseDto } from '@lms/shared';

import { DRIZZLE, type Db } from '../db/db.module';
import { courses, modules } from '../db/schema';

type CourseRow = typeof courses.$inferSelect;
type ModuleRow = typeof modules.$inferSelect;

/**
 * Manages the org's program of study: its single course (docs/03 §5 — the
 * MVP assumes one course per org, same assumption `CurriculumService` makes)
 * and that course's modules. Reading the resulting tree (with lessons +
 * per-student progress) stays on `GET /curriculum`; this service only owns
 * the mutations, restricted to `teacher`/`admin` at the controller.
 */
@Injectable()
export class ProgramService {
  constructor(@Inject(DRIZZLE) private readonly db: Db) {}

  /** The org's course, or null if it hasn't been created yet. */
  async getCourse(orgId: string): Promise<CourseRow | null> {
    const [course] = await this.db
      .select()
      .from(courses)
      .where(eq(courses.organizationId, orgId))
      .orderBy(asc(courses.createdAt))
      .limit(1);
    return course ?? null;
  }

  /** Create the org's course on first call; patch title/description after. */
  async upsertCourse(orgId: string, dto: UpsertCourseDto): Promise<CourseRow> {
    const existing = await this.getCourse(orgId);
    if (!existing) {
      const [created] = await this.db
        .insert(courses)
        .values({
          organizationId: orgId,
          title: dto.title,
          description: dto.description ?? null,
        })
        .returning();
      return created;
    }
    const [updated] = await this.db
      .update(courses)
      .set({
        title: dto.title,
        description: dto.description ?? existing.description,
      })
      .where(eq(courses.id, existing.id))
      .returning();
    return updated;
  }

  /**
   * Create a module under the org's course, appended at the end. Auto-creates
   * a default-titled course first if the org doesn't have one yet — a teacher
   * shouldn't have to know "create a course" is a separate step.
   */
  async createModule(orgId: string, dto: CreateModuleDto): Promise<ModuleRow> {
    const course =
      (await this.getCourse(orgId)) ??
      (await this.upsertCourse(orgId, { title: 'Программа обучения' }));

    const [{ maxOrder }] = await this.db
      .select({ maxOrder: sql<number>`coalesce(max(${modules.order}), -1)` })
      .from(modules)
      .where(eq(modules.courseId, course.id));

    const [created] = await this.db
      .insert(modules)
      .values({
        courseId: course.id,
        title: dto.title,
        code: dto.code ?? null,
        order: Number(maxOrder) + 1,
      })
      .returning();
    return created;
  }

  /** Rename / re-code / reorder a module; tenant-scoped. */
  async updateModule(
    orgId: string,
    moduleId: string,
    dto: UpdateModuleDto,
  ): Promise<ModuleRow> {
    await this.assertModuleInOrg(moduleId, orgId);

    const patch: Partial<typeof modules.$inferInsert> = {};
    if (dto.title !== undefined) patch.title = dto.title;
    if (dto.code !== undefined) patch.code = dto.code;
    if (dto.order !== undefined) patch.order = dto.order;

    const [updated] = await this.db
      .update(modules)
      .set(patch)
      .where(eq(modules.id, moduleId))
      .returning();
    return updated;
  }

  /** Delete a module; tenant-scoped. Lessons in it fall back to unassigned
   * (their `module_id` is set null by the FK, matching `LessonsService`'s
   * treatment of orphaned lessons as invisible-to-everyone). */
  async deleteModule(orgId: string, moduleId: string): Promise<{ id: string }> {
    await this.assertModuleInOrg(moduleId, orgId);
    await this.db.delete(modules).where(eq(modules.id, moduleId));
    return { id: moduleId };
  }

  /** Assert a module belongs to `orgId`; throws 404 (not 403) otherwise. */
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
