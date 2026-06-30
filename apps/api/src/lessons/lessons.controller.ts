import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  UseGuards,
} from '@nestjs/common';
import {
  createLessonSchema,
  saveBlocksSchema,
  updateLessonSchema,
  type AuthUserPayload,
  type CreateLessonDto,
  type CurriculumTree,
  type SaveBlocksDto,
  type UpdateLessonDto,
} from '@lms/shared';

import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { BlocksService } from './blocks.service';
import { CurriculumService } from './curriculum.service';
import { LessonsService } from './lessons.service';

/**
 * Lesson + workbook + curriculum REST surface (docs/03 §3).
 *
 * Every route requires a valid User JWT (`JwtAuthGuard`) and is scoped to the
 * caller's organization via `@CurrentUser().orgId`. Mutations additionally
 * require the `teacher` role (`RolesGuard` + `@Roles('teacher')`).
 *
 * `POST /lessons/:id/blocks/generate` is intentionally NOT defined here — it is
 * owned by the AI module, which reuses `BlocksService.saveBlocks`.
 */
@Controller()
@UseGuards(JwtAuthGuard)
export class LessonsController {
  constructor(
    private readonly lessons: LessonsService,
    private readonly blocks: BlocksService,
    private readonly curriculum: CurriculumService,
  ) {}

  /** GET /lessons — list the organization's lessons (teacher). */
  @Get('lessons')
  @UseGuards(RolesGuard)
  @Roles('teacher')
  list(@CurrentUser() user: AuthUserPayload) {
    return this.lessons.list(user.orgId);
  }

  /** POST /lessons — create a lesson (teacher). */
  @Post('lessons')
  @UseGuards(RolesGuard)
  @Roles('teacher')
  create(
    @CurrentUser() user: AuthUserPayload,
    @Body(new ZodValidationPipe(createLessonSchema)) dto: CreateLessonDto,
  ) {
    return this.lessons.create(user.orgId, user.sub, dto);
  }

  /** GET /lessons/:id — a lesson with its blocks and outcomes (teacher/student). */
  @Get('lessons/:id')
  get(
    @CurrentUser() user: AuthUserPayload,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.lessons.getWithContent(user.orgId, id);
  }

  /** PATCH /lessons/:id — rename / move (teacher). */
  @Patch('lessons/:id')
  @UseGuards(RolesGuard)
  @Roles('teacher')
  update(
    @CurrentUser() user: AuthUserPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(updateLessonSchema)) dto: UpdateLessonDto,
  ) {
    return this.lessons.update(user.orgId, id, dto);
  }

  /** DELETE /lessons/:id — delete (teacher). */
  @Delete('lessons/:id')
  @UseGuards(RolesGuard)
  @Roles('teacher')
  remove(
    @CurrentUser() user: AuthUserPayload,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.lessons.remove(user.orgId, id);
  }

  /** PUT /lessons/:id/blocks — bulk save blocks, "Publish" semantics (teacher). */
  @Put('lessons/:id/blocks')
  @UseGuards(RolesGuard)
  @Roles('teacher')
  saveBlocks(
    @CurrentUser() user: AuthUserPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(saveBlocksSchema)) dto: SaveBlocksDto,
  ) {
    return this.blocks.saveBlocks(user.orgId, id, dto.blocks);
  }

  /**
   * GET /curriculum — the program-of-study tree (everyone).
   * Students get their per-lesson progress merged in; other roles get the
   * plain tree.
   */
  @Get('curriculum')
  curriculumTree(
    @CurrentUser() user: AuthUserPayload,
  ): Promise<CurriculumTree> {
    if (user.role === 'student') {
      return this.curriculum.curriculumForStudent(user.orgId, user.sub);
    }
    return this.curriculum.getCurriculumTree(user.orgId);
  }
}
