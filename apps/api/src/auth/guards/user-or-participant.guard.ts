import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ExtractJwt } from 'passport-jwt';
import type { Request } from 'express';

import { AuthService } from '../auth.service';

/**
 * Authenticates a request as EITHER a real user (aud=user) or a session
 * participant (aud=participant), populating `request.user` with the
 * discriminated payload (`AuthUserPayload | ParticipantPayload`).
 *
 * Used by endpoints that both teachers and joined students must reach — notably
 * `GET /sessions/:id`, where a student holds only a participant token. The
 * *authorization* decision (which session / org the caller may see) is left to
 * the handler, which branches on `aud`.
 */
@Injectable()
export class UserOrParticipantGuard implements CanActivate {
  constructor(private readonly auth: AuthService) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx
      .switchToHttp()
      .getRequest<
        Request & { cookies?: Record<string, string>; user?: unknown }
      >();

    const token =
      ExtractJwt.fromAuthHeaderAsBearerToken()(req) ??
      req.cookies?.access_token ??
      req.cookies?.participant_token ??
      null;

    if (!token) throw new UnauthorizedException('missing_token');

    // Throws UnauthorizedException on an invalid/forged token.
    req.user = await this.auth.verifySocketToken(token);
    return true;
  }
}
