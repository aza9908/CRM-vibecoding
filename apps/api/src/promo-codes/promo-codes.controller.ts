import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  createPromoCodeSchema,
  type AuthUserPayload,
  type CreatePromoCodeDto,
} from '@lms/shared';

import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { PromoCodesService } from './promo-codes.service';

/**
 * Promo code management for a company's own program. Every route requires a
 * User JWT + `teacher`/`methodist`/`admin` role (identical permissions,
 * TZ_LMS_roles_promocodes.md §3.1/§3.2) and is scoped to
 * `@CurrentUser().orgId` — staff can only see and manage their own
 * organization's codes here, matching `AdminController`. Cross-org visibility
 * for the platform operator stays on `PlatformController` instead.
 */
@Controller('admin/promo-codes')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('teacher', 'methodist', 'admin')
export class PromoCodesController {
  constructor(private readonly promoCodes: PromoCodesService) {}

  /** GET /admin/promo-codes — list the org's codes. */
  @Get()
  list(@CurrentUser() user: AuthUserPayload) {
    return this.promoCodes.listForOrg(user.orgId);
  }

  /** POST /admin/promo-codes — issue a new code for the org. */
  @Post()
  create(
    @CurrentUser() user: AuthUserPayload,
    @Body(new ZodValidationPipe(createPromoCodeSchema)) dto: CreatePromoCodeDto,
  ) {
    return this.promoCodes.create(user.orgId, user.sub, dto);
  }

  /** PATCH /admin/promo-codes/:id/revoke — deactivate a code. */
  @Patch(':id/revoke')
  @HttpCode(HttpStatus.OK)
  async revoke(
    @CurrentUser() user: AuthUserPayload,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    await this.promoCodes.revoke(user.orgId, id);
    return { id };
  }
}
