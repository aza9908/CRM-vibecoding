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
  createTaskSchema,
  updateTaskSchema,
  type AuthUserPayload,
  type CreateTaskDto,
  type UpdateTaskDto,
} from '@lms/shared';

import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { TelegramService } from '../common/telegram.service';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { TasksService } from './tasks.service';

/**
 * Internal Задачи board (docs/10). Admin-only — this is the team's own
 * task tracker, not a student/teacher-facing feature — and scoped to
 * `@CurrentUser().orgId` like every other tenant-owned resource.
 */
@Controller('tasks')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin')
export class TasksController {
  constructor(
    private readonly tasks: TasksService,
    private readonly telegram: TelegramService,
  ) {}

  @Get()
  list(@CurrentUser() user: AuthUserPayload) {
    return this.tasks.list(user.orgId);
  }

  /** GET /tasks/meta — whether the Telegram bot is wired up (for a status badge). */
  @Get('meta')
  meta(): { telegramConfigured: boolean } {
    return { telegramConfigured: this.telegram.isConfigured };
  }

  @Post()
  create(
    @CurrentUser() user: AuthUserPayload,
    @Body(new ZodValidationPipe(createTaskSchema)) dto: CreateTaskDto,
  ) {
    return this.tasks.create(user.orgId, user.sub, dto);
  }

  @Patch(':id')
  update(
    @CurrentUser() user: AuthUserPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(updateTaskSchema)) dto: UpdateTaskDto,
  ) {
    return this.tasks.update(user.orgId, id, dto);
  }

  @Delete(':id')
  remove(
    @CurrentUser() user: AuthUserPayload,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.tasks.remove(user.orgId, id);
  }
}
