import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module';
import { TelegramService } from '../common/telegram.service';
import { TasksController } from './tasks.controller';
import { TasksService } from './tasks.service';

/** Internal Задачи (tasks) board module — admin-only, org-scoped. */
@Module({
  imports: [AuthModule],
  controllers: [TasksController],
  providers: [TasksService, TelegramService],
})
export class TasksModule {}
