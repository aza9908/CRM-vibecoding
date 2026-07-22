import {
  Body,
  Controller,
  Delete,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  createModuleSchema,
  updateModuleSchema,
  upsertCourseSchema,
  type AuthUserPayload,
  type CreateModuleDto,
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
@Roles('teacher', 'admin')
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
}
