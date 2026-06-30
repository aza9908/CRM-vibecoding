import {
  Controller,
  Delete,
  Get,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import {
  createMaterialSchema,
  updateMaterialSchema,
  type AuthUserPayload,
  type CreateMaterialDto,
  type LessonMaterial,
  type MaterialDto,
  type ParticipantPayload,
  type UpdateMaterialDto,
} from '@lms/shared';

import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { UserOrParticipantGuard } from '../auth/guards/user-or-participant.guard';
import { ZodBody } from '../common/zod-body.decorator';
import { LessonsService } from '../lessons/lessons.service';
import { SessionsService } from '../sessions/sessions.service';
import { StorageService } from '../storage/storage.service';
import { MaterialsService } from './materials.service';

/** TTL (seconds) for a material file's presigned download URL. */
const DOWNLOAD_TTL_SECONDS = 300;

/**
 * Materials REST surface (docs/07 §3).
 *
 * Teacher CRUD (`GET/POST/PATCH/DELETE /materials`) requires a User JWT +
 * `teacher` role and is scoped to `@CurrentUser().orgId`. The two read routes
 * reachable by joined students — `GET /lessons/:id/materials` and
 * `GET /materials/:id/download` — accept EITHER a user or a participant token
 * (`UserOrParticipantGuard`) and branch on `req.user.aud` to authorize access
 * by org (user) or by the session's lesson (participant). Cross-tenant access
 * returns 404, never 403.
 */
@Controller()
export class MaterialsController {
  constructor(
    private readonly materials: MaterialsService,
    private readonly lessons: LessonsService,
    private readonly sessions: SessionsService,
    private readonly storage: StorageService,
  ) {}

  /** GET /materials — all materials of the caller's org (teacher). */
  @Get('materials')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('teacher')
  list(@CurrentUser() user: AuthUserPayload): Promise<MaterialDto[]> {
    return this.materials.list(user.orgId);
  }

  /** POST /materials — create a material, optionally attached to lessons (teacher). */
  @Post('materials')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('teacher')
  create(
    @CurrentUser() user: AuthUserPayload,
    @ZodBody(createMaterialSchema) dto: CreateMaterialDto,
  ): Promise<MaterialDto> {
    return this.materials.create(user.orgId, user.sub, dto);
  }

  /** PATCH /materials/:id — rename / re-point / re-attach to lessons (teacher). */
  @Patch('materials/:id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('teacher')
  update(
    @CurrentUser() user: AuthUserPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @ZodBody(updateMaterialSchema) dto: UpdateMaterialDto,
  ): Promise<MaterialDto> {
    return this.materials.update(user.orgId, id, dto);
  }

  /** DELETE /materials/:id — delete (drops the S3 file for `file` type) (teacher). */
  @Delete('materials/:id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('teacher')
  async remove(
    @CurrentUser() user: AuthUserPayload,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<{ id: string }> {
    const { id: deletedId, fileKey } = await this.materials.remove(
      user.orgId,
      id,
    );
    if (fileKey) {
      await this.storage.deleteObject(fileKey);
    }
    return { id: deletedId };
  }

  /**
   * GET /lessons/:id/materials — materials attached to a lesson, for the
   * right-panel view. Reachable by a teacher (org-scoped) or a joined student
   * (their session's lesson must be this lesson, or share its org).
   */
  @Get('lessons/:id/materials')
  @UseGuards(UserOrParticipantGuard)
  async forLesson(
    @Req() req: Request,
    @Param('id', ParseUUIDPipe) lessonId: string,
  ): Promise<LessonMaterial[]> {
    await this.assertLessonAccess(req, lessonId);
    return this.materials.listForLesson(lessonId);
  }

  /**
   * GET /materials/:id/download — resolve a download URL. Links are returned
   * as-is; files get a short-lived presigned GET. Reachable by a teacher
   * (org-scoped) or a joined student (the material must be attached to their
   * session's lesson, or share its org).
   */
  @Get('materials/:id/download')
  @UseGuards(UserOrParticipantGuard)
  async download(
    @Req() req: Request,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<{ url: string }> {
    await this.assertMaterialAccess(req, id);
    const material = await this.materials.getForDownload(id);
    if (material.type === 'link') {
      return { url: material.url };
    }
    const url = await this.storage.getSignedGetUrl(
      material.url,
      DOWNLOAD_TTL_SECONDS,
    );
    return { url };
  }

  /**
   * Authorize access to a lesson for the principal on `req.user`.
   *  - user (aud=user/undefined): the lesson must belong to user.orgId.
   *  - participant: their session's lesson must be this lesson, or, failing
   *    that, the lesson must belong to the session's org.
   * Either failure surfaces as 404 (don't leak cross-tenant existence).
   */
  private async assertLessonAccess(
    req: Request,
    lessonId: string,
  ): Promise<void> {
    const principal = req.user as AuthUserPayload | ParticipantPayload;
    if (principal.aud === 'participant') {
      const orgId = await this.participantLessonOrg(principal, lessonId);
      await this.lessons.assertLessonInOrg(lessonId, orgId);
    } else {
      await this.lessons.assertLessonInOrg(lessonId, principal.orgId);
    }
  }

  /**
   * Authorize access to a material for the principal on `req.user`.
   *  - user: the material must belong to user.orgId.
   *  - participant: the material must be attached to their session's lesson
   *    (so they only ever reach materials surfaced in their own session).
   * Either failure surfaces as 404.
   */
  private async assertMaterialAccess(
    req: Request,
    materialId: string,
  ): Promise<void> {
    const principal = req.user as AuthUserPayload | ParticipantPayload;
    if (principal.aud === 'participant') {
      const session = await this.sessions.get(principal.sessionId);
      if (!session.lessonId) throw new NotFoundException('material_not_found');
      await this.materials.assertMaterialOnLesson(materialId, session.lessonId);
    } else {
      await this.materials.assertMaterialInOrg(materialId, principal.orgId);
    }
  }

  /**
   * Resolve the org a participant may act in for a given lesson and assert the
   * participant's session is actually for that lesson. Returns the session's
   * organizationId (used to scope the lesson lookup). 404 on any mismatch.
   */
  private async participantLessonOrg(
    principal: ParticipantPayload,
    lessonId: string,
  ): Promise<string> {
    const session = await this.sessions.get(principal.sessionId);
    if (session.lessonId !== lessonId || !session.organizationId) {
      throw new NotFoundException('lesson_not_found');
    }
    return session.organizationId;
  }
}
