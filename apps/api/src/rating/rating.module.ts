import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module';
import { UserOrParticipantGuard } from '../auth/guards/user-or-participant.guard';
import { RatingController } from './rating.controller';
import { RatingService } from './rating.service';

/**
 * Student rating feature (points for workbook work). Computed from existing
 * tables — no storage of its own. `AuthModule` provides the guards' strategies
 * and `AuthService` (used by `UserOrParticipantGuard`); `DRIZZLE` comes from
 * the global `DbModule`.
 */
@Module({
  imports: [AuthModule],
  controllers: [RatingController],
  providers: [RatingService, UserOrParticipantGuard],
})
export class RatingModule {}
