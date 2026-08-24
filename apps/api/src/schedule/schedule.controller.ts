import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  createScheduleEventSchema,
  PROGRAM_EDITOR_ROLES,
  updateScheduleEventSchema,
  type AuthUserPayload,
  type CreateScheduleEventDto,
  type UpdateScheduleEventDto,
} from '@lms/shared';

import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { ScheduleService } from './schedule.service';

/**
 * The company's study schedule.
 *
 * `GET /schedule` is open to every authenticated user in the org — it is what
 * личный кабинет renders. The mutations are limited to `PROGRAM_EDITOR_ROLES`:
 * an admin builds the program today, and curator/methodist exist so that can
 * be handed over without also handing over user management.
 */
@Controller('schedule')
@UseGuards(JwtAuthGuard, RolesGuard)
export class ScheduleController {
  constructor(private readonly schedule: ScheduleService) {}

  /** GET /schedule — the whole timeline, chronologically. */
  @Get()
  timeline(@CurrentUser() user: AuthUserPayload) {
    return this.schedule.getTimeline(user.orgId);
  }

  /** POST /schedule — add a lesson / Q&A / Demo day to the timeline. */
  @Post()
  @Roles(...PROGRAM_EDITOR_ROLES)
  create(
    @CurrentUser() user: AuthUserPayload,
    @Body(new ZodValidationPipe(createScheduleEventSchema))
    dto: CreateScheduleEventDto,
  ) {
    return this.schedule.create(user.orgId, user.sub, dto);
  }

  /** PATCH /schedule/:id — reschedule or re-label an event. */
  @Patch(':id')
  @Roles(...PROGRAM_EDITOR_ROLES)
  update(
    @CurrentUser() user: AuthUserPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(updateScheduleEventSchema))
    dto: UpdateScheduleEventDto,
  ) {
    return this.schedule.update(user.orgId, id, dto);
  }

  /** DELETE /schedule/:id. */
  @Delete(':id')
  @Roles(...PROGRAM_EDITOR_ROLES)
  remove(
    @CurrentUser() user: AuthUserPayload,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.schedule.remove(user.orgId, id);
  }
}
