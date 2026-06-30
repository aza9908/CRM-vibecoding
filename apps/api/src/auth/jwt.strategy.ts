import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy, type StrategyOptions } from 'passport-jwt';
import type { Request } from 'express';
import type { AuthUserPayload, UserRole } from '@lms/shared';

/** Passport strategy name for real-account (aud=user) access tokens. */
export const JWT_USER_STRATEGY = 'jwt-user';

interface RawUserClaims {
  sub?: unknown;
  role?: unknown;
  orgId?: unknown;
  aud?: unknown;
}

/**
 * Pull the access token from either the `Authorization: Bearer` header or the
 * `access_token` httpOnly cookie. The web client reads tokens from the response
 * body and sends the bearer header, but supporting the cookie keeps SSR and
 * cookie-only flows working.
 */
function extractToken(req: Request): string | null {
  const fromHeader = ExtractJwt.fromAuthHeaderAsBearerToken()(req);
  if (fromHeader) return fromHeader;
  const cookies = (req as Request & { cookies?: Record<string, string> })
    .cookies;
  return cookies?.access_token ?? null;
}

/**
 * Validates user access tokens (aud=user). Rejects participant tokens outright
 * so a session guest can never reach user endpoints.
 */
@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, JWT_USER_STRATEGY) {
  constructor(config: ConfigService) {
    const secret = config.get<string>('JWT_ACCESS_SECRET');
    if (!secret) {
      throw new Error('JWT_ACCESS_SECRET is not set');
    }
    const options: StrategyOptions = {
      jwtFromRequest: extractToken,
      ignoreExpiration: false,
      secretOrKey: secret,
    };
    super(options);
  }

  validate(payload: RawUserClaims): AuthUserPayload {
    // A participant token (aud=participant) must not authenticate as a user,
    // even though it is signed with the same secret.
    if (payload.aud === 'participant') {
      throw new UnauthorizedException('wrong_audience');
    }
    if (
      typeof payload.sub !== 'string' ||
      typeof payload.role !== 'string' ||
      typeof payload.orgId !== 'string'
    ) {
      throw new UnauthorizedException('invalid_token');
    }
    return {
      sub: payload.sub,
      role: payload.role as UserRole,
      orgId: payload.orgId,
      aud: 'user',
    };
  }
}
