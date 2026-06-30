import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, eq, inArray } from 'drizzle-orm';
import type {
  CreateMaterialDto,
  LessonMaterial,
  MaterialDto,
  UpdateMaterialDto,
} from '@lms/shared';

import { DRIZZLE, type Db } from '../db/db.module';
import { courseMaterials, lessonMaterials, lessons } from '../db/schema';

/** A raw `course_materials` row. */
type MaterialRow = typeof courseMaterials.$inferSelect;

/**
 * Materials CRUD + lesson attachment (docs/07).
 *
 * Multi-tenant isolation is application-level (no RLS). `course_materials` has a
 * direct `organization_id`, so every read/write asserts the material belongs to
 * `orgId`. Lesson attachments are validated the same way: a material may only be
 * linked to lessons in its own organization (`lessons.organization_id`).
 *
 * Cross-tenant access surfaces as 404 (NotFoundException), never 403, so the
 * existence of another org's material/lesson is not leaked.
 */
@Injectable()
export class MaterialsService {
  constructor(@Inject(DRIZZLE) private readonly db: Db) {}

  /** List every material owned by `orgId`. */
  async list(orgId: string): Promise<MaterialDto[]> {
    const rows = await this.db
      .select()
      .from(courseMaterials)
      .where(eq(courseMaterials.organizationId, orgId))
      .orderBy(courseMaterials.createdAt);

    return rows.map(toMaterialDto);
  }

  /**
   * Create a material owned by `orgId`, authored by `userId`, optionally
   * attaching it to `lessonIds` (each asserted in-org). Runs in a transaction so
   * a bad lessonId rolls the material insert back too.
   */
  async create(
    orgId: string,
    userId: string,
    dto: CreateMaterialDto,
  ): Promise<MaterialDto> {
    const material = await this.db.transaction(async (tx) => {
      const [m] = await tx
        .insert(courseMaterials)
        .values({
          organizationId: orgId,
          createdBy: userId,
          title: dto.title,
          type: dto.type,
          url: dto.url,
        })
        .returning();

      if (dto.lessonIds?.length) {
        await this.assertLessonsInOrg(tx, dto.lessonIds, orgId);
        await tx
          .insert(lessonMaterials)
          .values(
            dto.lessonIds.map((lessonId) => ({ lessonId, materialId: m.id })),
          );
      }

      return m;
    });

    return toMaterialDto(material);
  }

  /**
   * Update a material's fields and/or re-attach it to lessons. When `lessonIds`
   * is provided, the full set of links is replaced (delete-then-reinsert), with
   * every new lesson asserted in-org. Tenant-scoped via the material's org.
   */
  async update(
    orgId: string,
    materialId: string,
    dto: UpdateMaterialDto,
  ): Promise<MaterialDto> {
    const current = await this.assertMaterialInOrg(materialId, orgId);

    const patch: Partial<typeof courseMaterials.$inferInsert> = {};
    if (dto.title !== undefined) patch.title = dto.title;
    if (dto.type !== undefined) patch.type = dto.type;
    if (dto.url !== undefined) patch.url = dto.url;

    return this.db.transaction(async (tx) => {
      let row: MaterialRow = current;

      if (Object.keys(patch).length > 0) {
        const [updated] = await tx
          .update(courseMaterials)
          .set(patch)
          .where(eq(courseMaterials.id, materialId))
          .returning();
        row = updated;
      }

      if (dto.lessonIds !== undefined) {
        await tx
          .delete(lessonMaterials)
          .where(eq(lessonMaterials.materialId, materialId));

        if (dto.lessonIds.length) {
          await this.assertLessonsInOrg(tx, dto.lessonIds, orgId);
          await tx
            .insert(lessonMaterials)
            .values(
              dto.lessonIds.map((lessonId) => ({ lessonId, materialId })),
            );
        }
      }

      return toMaterialDto(row);
    });
  }

  /**
   * Delete a material; tenant-scoped. For `file` materials the backing S3 object
   * is removed first (best-effort: the row is deleted regardless). The
   * `lesson_materials` links cascade via FK. Returns the deleted id and the S3
   * key to drop (null for links), so the controller can call storage.
   */
  async remove(
    orgId: string,
    materialId: string,
  ): Promise<{ id: string; fileKey: string | null }> {
    const material = await this.assertMaterialInOrg(materialId, orgId);
    await this.db
      .delete(courseMaterials)
      .where(eq(courseMaterials.id, materialId));
    return {
      id: materialId,
      fileKey: material.type === 'file' ? material.url : null,
    };
  }

  /**
   * Materials linked to a lesson, for the student/teacher right-panel view.
   * The raw url (S3 key) is intentionally omitted — downloads go through
   * `getDownload`. Caller is responsible for asserting access to the lesson.
   */
  async listForLesson(lessonId: string): Promise<LessonMaterial[]> {
    const rows = await this.db
      .select({
        id: courseMaterials.id,
        title: courseMaterials.title,
        type: courseMaterials.type,
      })
      .from(lessonMaterials)
      .innerJoin(
        courseMaterials,
        eq(courseMaterials.id, lessonMaterials.materialId),
      )
      .where(eq(lessonMaterials.lessonId, lessonId))
      .orderBy(courseMaterials.createdAt);

    return rows;
  }

  /**
   * Resolve a material for download. Returns its type and url (S3 key for files,
   * external href for links) so the controller can mint a presigned GET or hand
   * the link back as-is. Caller asserts access (org or lesson) first; this only
   * loads the row and throws 404 if it is missing.
   */
  async getForDownload(
    materialId: string,
  ): Promise<{ type: MaterialRow['type']; url: string }> {
    const [row] = await this.db
      .select({ type: courseMaterials.type, url: courseMaterials.url })
      .from(courseMaterials)
      .where(eq(courseMaterials.id, materialId))
      .limit(1);

    if (!row) throw new NotFoundException('material_not_found');
    return row;
  }

  /**
   * Assert a material exists and belongs to `orgId`; returns the row.
   * Throws 404 (not 403) so other tenants' materials are not leaked.
   */
  async assertMaterialInOrg(
    materialId: string,
    orgId: string,
  ): Promise<MaterialRow> {
    const [row] = await this.db
      .select()
      .from(courseMaterials)
      .where(
        and(
          eq(courseMaterials.id, materialId),
          eq(courseMaterials.organizationId, orgId),
        ),
      )
      .limit(1);

    if (!row) throw new NotFoundException('material_not_found');
    return row;
  }

  /**
   * Assert a material is linked to a given lesson (used to authorize a session
   * participant's access to a material via their session's lesson). Throws 404
   * if no such link exists.
   */
  async assertMaterialOnLesson(
    materialId: string,
    lessonId: string,
  ): Promise<void> {
    const [row] = await this.db
      .select({ materialId: lessonMaterials.materialId })
      .from(lessonMaterials)
      .where(
        and(
          eq(lessonMaterials.materialId, materialId),
          eq(lessonMaterials.lessonId, lessonId),
        ),
      )
      .limit(1);

    if (!row) throw new NotFoundException('material_not_found');
  }

  /**
   * Assert every lesson in `lessonIds` belongs to `orgId`. Used before creating
   * `lesson_materials` links so a material is never attached across tenants.
   * Throws 404 if any lesson is missing or out-of-org.
   */
  private async assertLessonsInOrg(
    tx: Db,
    lessonIds: string[],
    orgId: string,
  ): Promise<void> {
    const unique = [...new Set(lessonIds)];
    const rows = await tx
      .select({ id: lessons.id })
      .from(lessons)
      .where(
        and(
          inArray(lessons.id, unique),
          eq(lessons.organizationId, orgId),
        ),
      );

    if (rows.length !== unique.length) {
      throw new NotFoundException('lesson_not_found');
    }
  }
}

/** Map a raw material row to the API DTO (timestamps as ISO strings). */
function toMaterialDto(row: MaterialRow): MaterialDto {
  return {
    id: row.id,
    organizationId: row.organizationId,
    createdBy: row.createdBy,
    title: row.title,
    type: row.type,
    url: row.url,
    createdAt: (row.createdAt ?? new Date()).toISOString(),
  };
}
