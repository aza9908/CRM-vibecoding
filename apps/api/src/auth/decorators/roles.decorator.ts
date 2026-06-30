import { SetMetadata } from '@nestjs/common';
import type { UserRole } from '@lms/shared';

/** Metadata key under which required roles are stored for `RolesGuard`. */
export const ROLES_KEY = 'roles';

/**
 * Restrict a route (or controller) to one or more user roles.
 *
 *   @UseGuards(JwtAuthGuard, RolesGuard)
 *   @Roles('teacher', 'admin')
 *   create() { ... }
 *
 * Must be combined with `RolesGuard`, which compares these against
 * `request.user.role`.
 */
export const Roles = (...roles: UserRole[]): MethodDecorator & ClassDecorator =>
  SetMetadata(ROLES_KEY, roles);
