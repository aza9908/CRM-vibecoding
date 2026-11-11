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
@Roles('teacher', 'methodist', 'admin')
export class AdminWorkbookController {
  constructor(private readonly seed: WorkbookSeedService) {}

  /**
   * POST /admin/workbook/seed — create/refresh the Day-1 lesson + blocks for
   * the caller's organization. Idempotent.
   */
  @Post('seed')
  @HttpCode(HttpStatus.OK)
  async seedWorkbook(@CurrentUser() user: AuthUserPayload) {
    const result = await this.seed.seed({
      orgId: user.orgId,
      teacherEmail: null,
    });
    // Attribute the workshop lesson to the teacher who triggered the seed
    // so it shows under their Уроки ownership consistently.
    await this.seed.assignTeacher(result.lessonId, user.sub);
    return result;
  }

  /**
   * POST /admin/workbook/seed-orzu — create/refresh the Orzu Medical
   * VibeOps week-1 lesson (RU + UZ) in the caller's organization. Idempotent.
   * Orgs whose name contains "Orzu" also get it automatically on API boot.
   */
  @Post('seed-orzu')
  @HttpCode(HttpStatus.OK)
  async seedOrzu(@CurrentUser() user: AuthUserPayload) {
    return this.seed.seedOrzuWeek1({ orgId: user.orgId, teacherId: user.sub });
  }

  /**
   * POST /admin/workbook/seed-all — platform bootstrap only.
   * Restricted to admin: teachers must use POST /admin/workbook/seed (own org).
   */
  @Post('seed-all')
  @HttpCode(HttpStatus.OK)
  @Roles('admin')
  async seedAll() {
    const { orgs, results } = await this.seed.seedAllOrgs();
    // Do not leak other tenants' orgId/lessonId to the caller.
    return {
      orgs,
      seeded: results.length,
      blocks: results[0]?.blocks ?? 0,
    };
  }
}
