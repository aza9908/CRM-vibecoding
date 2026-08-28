import {
  Body,
  Controller,
  Delete,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  UseGuards,
} from '@nestjs/common';
import {
  createModuleSchema,
  reorderLessonsSchema,
  reorderModulesSchema,
  updateModuleSchema,
  upsertCourseSchema,
  type AuthUserPayload,
  type CreateModuleDto,
  type ReorderLessonsDto,
  type ReorderModulesDto,
  type UpdateModuleDto,
  type UpsertCourseDto,
} from '@lms/shared';

import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { ProgramService } from './program.service';

/**
 * Program-of-study management (docs/03 §5). Read access to the tree stays on
 * `GET /curriculum` (any authenticated user); every mutation here requires a
 * User JWT + `teacher` or `admin` role and is scoped to `@CurrentUser().orgId`.
 */
@Controller('program')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('teacher', 'methodist', 'admin')
export class ProgramController {
  constructor(private readonly program: ProgramService) {}

  /** POST /program/course — create/patch the org's single course. */
  @Post('course')
  upsertCourse(
    @CurrentUser() user: AuthUserPayload,
    @Body(new ZodValidationPipe(upsertCourseSchema)) dto: UpsertCourseDto,
  ) {
    return this.program.upsertCourse(user.orgId, dto);
  }

  /** POST /program/modules — append a new module. */
  @Post('modules')
  createModule(
    @CurrentUser() user: AuthUserPayload,
    @Body(new ZodValidationPipe(createModuleSchema)) dto: CreateModuleDto,
  ) {
    return this.program.createModule(user.orgId, dto);
  }

  /** PATCH /program/modules/:id — rename / re-code / reorder. */
  @Patch('modules/:id')
  updateModule(
    @CurrentUser() user: AuthUserPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(updateModuleSchema)) dto: UpdateModuleDto,
  ) {
    return this.program.updateModule(user.orgId, id, dto);
  }

  /** DELETE /program/modules/:id. */
  @Delete('modules/:id')
  deleteModule(
    @CurrentUser() user: AuthUserPayload,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.program.deleteModule(user.orgId, id);
  }

  /** PUT /program/modules/order — reorder the org's modules (drag-and-drop). */
  @Put('modules/order')
  reorderModules(
    @CurrentUser() user: AuthUserPayload,
    @Body(new ZodValidationPipe(reorderModulesSchema)) dto: ReorderModulesDto,
  ) {
    return this.program.reorderModules(user.orgId, dto.moduleIds);
  }

  /** PUT /program/modules/:id/lessons/order — reorder lessons within a module. */
  @Put('modules/:id/lessons/order')
  reorderLessons(
    @CurrentUser() user: AuthUserPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(reorderLessonsSchema)) dto: ReorderLessonsDto,
  ) {
    return this.program.reorderLessons(user.orgId, id, dto.lessonIds);
  }
}
