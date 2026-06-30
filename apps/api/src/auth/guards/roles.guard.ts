import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import type { AuthUserPayload, UserRole } from '@lms/shared';

import { ROLES_KEY } from '../decorators/roles.decorator';

/**
 * Authorizes a request against the roles declared via `@Roles(...)`.
 *
 * Reads metadata at both the handler and class level (handler wins if present).
 * Must run after `JwtAuthGuard`, which populates `request.user`. If no `@Roles`
 * is set, the route is open to any authenticated user.
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<UserRole[] | undefined>(
      ROLES_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (!required || required.length === 0) {
      return true;
    }

    const request = context.switchToHttp().getRequest<Request>();
    const user = request.user as AuthUserPayload | undefined;
    if (!user || !user.role) {
      throw new ForbiddenException('forbidden');
    }
    if (!required.includes(user.role)) {
      throw new ForbiddenException('insufficient_role');
    }
    return true;
  }
}
