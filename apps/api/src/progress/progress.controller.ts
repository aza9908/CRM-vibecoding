import {
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Put,
  UseGuards,
} from '@nestjs/common';
import {
  saveNotesSchema,
  updateProgressSchema,
  type AuthUserPayload,
  type LessonProgressView,
  type SaveNotesDto,
  type UpdateProgressDto,
} from '@lms/shared';

import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { ZodBody } from '../common/zod-body.decorator';
import { NotesService } from './notes.service';
import { ProgressService } from './progress.service';

/**
 * Lesson progress + notes REST surface (docs/08 §5).
 *
 * Every route requires a User JWT (`JwtAuthGuard`) and asserts the target
 * lesson belongs to `@CurrentUser().orgId` (404 on a cross-tenant id). Progress
 * is student-only (`RolesGuard` + `@Roles('student')` — analytics only tracks
 * authenticated learners, docs/08 §5); notes are available to any
 * authenticated user keeping notes on a lesson.
 */
@Controller()
@UseGuards(JwtAuthGuard)
export class ProgressController {
  constructor(
    private readonly progress: ProgressService,
    private readonly notes: NotesService,
  ) {}

  /** PUT /lessons/:id/progress — persist lesson-summary percent (student). */
  @Put('lessons/:id/progress')
  @UseGuards(RolesGuard)
  @Roles('student')
  async updateProgress(
    @CurrentUser() user: AuthUserPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @ZodBody(updateProgressSchema) dto: UpdateProgressDto,
  ): Promise<LessonProgressView> {
    const orgId = await this.progress.assertLessonOrg(id, user.orgId);
    return this.progress.upsert(orgId, user.sub, id, dto.percent);
  }

  /** GET /lessons/:id/notes — the caller's note for this lesson ('' if none). */
  @Get('lessons/:id/notes')
  async getNotes(
    @CurrentUser() user: AuthUserPayload,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<{ content: string }> {
    await this.progress.assertLessonOrg(id, user.orgId);
    const content = await this.notes.getContent(user.sub, id);
    return { content };
  }

  /** PUT /lessons/:id/notes — upsert the caller's note for this lesson. */
  @Put('lessons/:id/notes')
  async saveNotes(
    @CurrentUser() user: AuthUserPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @ZodBody(saveNotesSchema) dto: SaveNotesDto,
  ): Promise<{ content: string }> {
    await this.progress.assertLessonOrg(id, user.orgId);
    return this.notes.save(user.sub, id, dto.content);
  }
}
