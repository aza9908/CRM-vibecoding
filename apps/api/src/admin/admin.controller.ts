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
  createUserSchema,
  type AuthUserPayload,
  type ChangeUserRoleDto,
  type CreateUserDto,
} from '@lms/shared';

import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { AdminService } from './admin.service';

/**
 * Staff user management (docs/02). Every route requires a User JWT +
 * `teacher`/`methodist`/`admin` role (identical permissions here, per
 * TZ_LMS_roles_promocodes.md §3.1) and is scoped to `@CurrentUser().orgId` —
 * staff can only see and manage users inside their own organization, never
 * across tenants. The one exception is granting/touching the `admin` role
 * itself, restricted to admins in `AdminService.changeRole`.
 */
@Controller('admin/users')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('teacher', 'methodist', 'admin')
export class AdminController {
  constructor(private readonly admin: AdminService) {}

  /** GET /admin/users — list the org's users. */
  @Get()
  list(@CurrentUser() user: AuthUserPayload) {
    return this.admin.listUsers(user.orgId);
  }

  /**
   * POST /admin/users — create a teacher/methodist/student account directly
   * (instead of the person self-registering with a promo code). Admin-only:
   * overrides the controller's class-level `teacher`/`methodist`/`admin`
   * group, unlike every other route here.
   */
  @Post()
  @Roles('admin')
  @HttpCode(HttpStatus.CREATED)
  createUser(
    @CurrentUser() user: AuthUserPayload,
    @Body(new ZodValidationPipe(createUserSchema)) dto: CreateUserDto,
  ) {
    return this.admin.createUser(user.orgId, dto);
  }

  /** PATCH /admin/users/:id/role — grant/revoke a role (incl. admin/team_lead). */
  @Patch(':id/role')
  changeRole(
    @CurrentUser() user: AuthUserPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(changeUserRoleSchema)) dto: ChangeUserRoleDto,
  ) {
    return this.admin.changeRole(user.orgId, id, user.sub, user.role, dto.role);
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
    return this.admin.resetPassword(user.orgId, id, user.role);
  }
}
