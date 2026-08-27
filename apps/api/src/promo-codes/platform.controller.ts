import {
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import type { AuthUserPayload } from '@lms/shared';

import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PlatformAdminGuard } from '../auth/guards/platform-admin.guard';
import { PromoCodesService } from './promo-codes.service';

/**
 * Cross-org promo code visibility for the platform admin — every company in
 * one list, each with its current code, rather than each company's own
 * `admin`/`teacher` managing their own via `PromoCodesController`. Gated by
 * `PlatformAdminGuard`, not `RolesGuard`: this deliberately bypasses the
 * usual `@CurrentUser().orgId` scoping that every other controller enforces,
 * so it must stay restricted to `isPlatformAdmin` accounts only.
 */
@Controller('platform')
@UseGuards(JwtAuthGuard, PlatformAdminGuard)
export class PlatformController {
  constructor(private readonly promoCodes: PromoCodesService) {}

  /** GET /platform/companies — every org + its current active code. */
  @Get('companies')
  listCompanies(@CurrentUser() user: AuthUserPayload) {
    return this.promoCodes.listAllCompaniesWithCodes(user.sub);
  }

  /** POST /platform/companies/:orgId/promo-codes/regenerate — reissue a code
   * (e.g. the previous one leaked or a company lost it). */
  @Post('companies/:orgId/promo-codes/regenerate')
  regenerate(
    @CurrentUser() user: AuthUserPayload,
    @Param('orgId', ParseUUIDPipe) orgId: string,
  ) {
    return this.promoCodes.regenerate(orgId, user.sub);
  }
}
