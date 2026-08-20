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
  createPromoCodeSchema,
  updateCompanySchema,
  updatePromoCodeSchema,
  type AuthUserPayload,
  type CreatePromoCodeDto,
  type UpdateCompanyDto,
  type UpdatePromoCodeDto,
} from '@lms/shared';

import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { CompaniesService } from './companies.service';

/**
 * Admin-only management of the caller's own company and the promo codes people
 * register with. Scoped to `@CurrentUser().orgId` throughout — there is no
 * route here that can read or write another tenant's company.
 */
@Controller('admin/company')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin')
export class CompaniesController {
  constructor(private readonly companies: CompaniesService) {}

  /** GET /admin/company — the company, its headcount, and its promo codes. */
  @Get()
  get(@CurrentUser() user: AuthUserPayload) {
    return this.companies.getCompany(user.orgId);
  }

  /** PATCH /admin/company — rename the company. */
  @Patch()
  rename(
    @CurrentUser() user: AuthUserPayload,
    @Body(new ZodValidationPipe(updateCompanySchema)) dto: UpdateCompanyDto,
  ) {
    return this.companies.renameCompany(user.orgId, dto);
  }

  /** POST /admin/company/promo-codes — issue a code for this company. */
  @Post('promo-codes')
  createCode(
    @CurrentUser() user: AuthUserPayload,
    @Body(new ZodValidationPipe(createPromoCodeSchema))
    dto: CreatePromoCodeDto,
  ) {
    return this.companies.createPromoCode(user.orgId, user.sub, dto);
  }

  /** PATCH /admin/company/promo-codes/:id — deactivate / re-cap / re-date. */
  @Patch('promo-codes/:id')
  updateCode(
    @CurrentUser() user: AuthUserPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(updatePromoCodeSchema))
    dto: UpdatePromoCodeDto,
  ) {
    return this.companies.updatePromoCode(user.orgId, id, dto);
  }

  /** DELETE /admin/company/promo-codes/:id — only while still unused. */
  @Delete('promo-codes/:id')
  deleteCode(
    @CurrentUser() user: AuthUserPayload,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.companies.deletePromoCode(user.orgId, id);
  }
}
