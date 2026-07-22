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
  changeUserRoleSchema,
  type AuthUserPayload,
  type ChangeUserRoleDto,
} from '@lms/shared';

import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { AdminService } from './admin.service';

/**
 * Admin-only user management (docs/02). Every route requires a User JWT +
 * `admin` role and is scoped to `@CurrentUser().orgId` — an admin can only
 * see and manage users inside their own organization, never across tenants.
 */
@Controller('admin/users')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin')
export class AdminController {
  constructor(private readonly admin: AdminService) {}

  /** GET /admin/users — list the org's users. */
  @Get()
  list(@CurrentUser() user: AuthUserPayload) {
    return this.admin.listUsers(user.orgId);
  }

  /** PATCH /admin/users/:id/role — grant/revoke a role (incl. admin/team_lead). */
  @Patch(':id/role')
  changeRole(
    @CurrentUser() user: AuthUserPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(changeUserRoleSchema)) dto: ChangeUserRoleDto,
  ) {
    return this.admin.changeRole(user.orgId, id, user.sub, dto.role);
  }

  /**
   * POST /admin/users/:id/reset-password — generate a new password for a
   * user and return it in plaintext exactly once. The admin is responsible
   * for relaying it to the user through a side channel.
   */
  @Post(':id/reset-password')
  @HttpCode(HttpStatus.OK)
  resetPassword(
    @CurrentUser() user: AuthUserPayload,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.admin.resetPassword(user.orgId, id);
  }
}
