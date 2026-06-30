import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';
import type { AuthUserPayload } from '@lms/shared';

/**
 * Resolve the authenticated user's decoded JWT payload from the request.
 *
 *   me(@CurrentUser() user: AuthUserPayload) { ... }
 *
 * Populated by `JwtStrategy` (Passport sets `request.user`). Only valid behind
 * `JwtAuthGuard`; without it `user` is undefined.
 */
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthUserPayload => {
    const request = ctx.switchToHttp().getRequest<Request>();
    return request.user as AuthUserPayload;
  },
);
