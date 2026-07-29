import {
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  UseGuards,
} from '@nestjs/common';
import type { AuthUserPayload } from '@lms/shared';

import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { WorkbookSeedService } from '../db/workbook-seed.service';

/**
 * Admin ops for the Day-1 workbook. Scoped to the caller's org — never seeds
 * into another tenant.
 */
@Controller('admin/workbook')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin')
export class AdminWorkbookController {
  constructor(private readonly seed: WorkbookSeedService) {}

  /**
   * POST /admin/workbook/seed — create/refresh the Day-1 lesson + blocks for
   * the admin's organization. Idempotent.
   */
  @Post('seed')
  @HttpCode(HttpStatus.OK)
  seedWorkbook(@CurrentUser() user: AuthUserPayload) {
    return this.seed.seed({
      orgId: user.orgId,
      teacherEmail: null,
    });
  }
}
