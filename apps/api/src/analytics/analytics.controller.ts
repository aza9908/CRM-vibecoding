import {
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  UseGuards,
} from '@nestjs/common';
import type {
  AuthUserPayload,
  CompanyStats,
  CompanyUserDetail,
} from '@lms/shared';

import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { AnalyticsService } from './analytics.service';

/**
 * Company-level analytics surface (docs/09 §6).
 *
 * Restricted to org leadership — `admin` OR `team_lead` (RolesGuard treats the
 * `@Roles(...)` list as "any of"). Both endpoints are scoped to the caller's
 * own organization (`user.orgId`); the per-user drilldown additionally asserts
 * the target user belongs to that org.
 */
@Controller('analytics')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin', 'team_lead')
export class AnalyticsController {
  constructor(private readonly analytics: AnalyticsService) {}

  /** GET /analytics/company — org dashboard summary. */
  @Get('company')
  company(@CurrentUser() user: AuthUserPayload): Promise<CompanyStats> {
    return this.analytics.companyStats(user.orgId);
  }

  /** GET /analytics/company/users/:userId — per-employee drilldown. */
  @Get('company/users/:userId')
  companyUser(
    @CurrentUser() user: AuthUserPayload,
    @Param('userId', ParseUUIDPipe) userId: string,
  ): Promise<CompanyUserDetail> {
    return this.analytics.companyUserDetail(user.orgId, userId);
  }
}
