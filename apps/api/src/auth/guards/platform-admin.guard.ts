import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import type { Request } from 'express';
import type { AuthUserPayload } from '@lms/shared';

/**
 * Authorizes a request as the platform-wide operator — distinct from
 * `RolesGuard`'s per-org `admin`/`teacher` roles. Used only by
 * `PlatformController` (cross-org promo code visibility). Must run after
 * `JwtAuthGuard`, which populates `request.user`.
 *
 * There is no self-service or admin-panel path to become a platform admin;
 * it's granted by a direct DB write to `users.is_platform_admin`.
 */
@Injectable()
export class PlatformAdminGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    const user = request.user as AuthUserPayload | undefined;
    if (!user?.isPlatformAdmin) {
      throw new ForbiddenException('platform_admin_only');
    }
    return true;
  }
}
