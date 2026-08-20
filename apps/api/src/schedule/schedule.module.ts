import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module';
import { ScheduleController } from './schedule.controller';
import { ScheduleService } from './schedule.service';

/** Study-schedule timeline shown in личный кабинет; org-scoped throughout. */
@Module({
  imports: [AuthModule],
  controllers: [ScheduleController],
  providers: [ScheduleService],
})
export class ScheduleModule {}
