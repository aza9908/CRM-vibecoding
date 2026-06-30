import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module';
import { AnalyticsController } from './analytics.controller';
import { AnalyticsService } from './analytics.service';
import { ReportsController } from './reports.controller';
import { ReportsService } from './reports.service';

/**
 * Reports + analytics feature module (docs/09).
 *
 * Two surfaces:
 *  - ReportsController (teacher): per-session reports + lesson-level export
 *    (`/lessons/:id/sessions`, `/sessions/:id/report`, `/reports/export`).
 *  - AnalyticsController (admin/team_lead): organization dashboard
 *    (`/analytics/company`, `/analytics/company/users/:userId`).
 *
 * `AuthModule` is imported so the controllers' guards (`JwtAuthGuard`,
 * `RolesGuard`) and their JWT strategy/providers resolve; `DRIZZLE` comes from
 * the global `DbModule`. Nothing is exported — this module is leaf-level.
 */
@Module({
  imports: [AuthModule],
  controllers: [ReportsController, AnalyticsController],
  providers: [ReportsService, AnalyticsService],
})
export class AnalyticsModule {}
