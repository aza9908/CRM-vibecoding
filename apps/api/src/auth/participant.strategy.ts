import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy, type StrategyOptions } from 'passport-jwt';
import type { Request } from 'express';
import type { ParticipantPayload } from '@lms/shared';

/** Passport strategy name for session-guest (aud=participant) tokens. */
export const JWT_PARTICIPANT_STRATEGY = 'jwt-participant';

interface RawParticipantClaims {
  sub?: unknown;
  sessionId?: unknown;
  aud?: unknown;
}

/**
 * Pull the participant token from the `Authorization: Bearer` header or the
 * `participant_token` cookie. The web client typically stores it client-side
 * and sends the bearer header.
 */
function extractToken(req: Request): string | null {
  const fromHeader = ExtractJwt.fromAuthHeaderAsBearerToken()(req);
  if (fromHeader) return fromHeader;
  const cookies = (req as Request & { cookies?: Record<string, string> })
    .cookies;
  return cookies?.participant_token ?? null;
}

/**
 * Validates participant tokens (aud=participant). Rejects anything that is not
 * explicitly a participant token, so a user access token cannot masquerade as a
 * participant either.
 */
@Injectable()
export class ParticipantStrategy extends PassportStrategy(
  Strategy,
  JWT_PARTICIPANT_STRATEGY,
) {
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

  validate(payload: RawParticipantClaims): ParticipantPayload {
    if (
      payload.aud !== 'participant' ||
      typeof payload.sub !== 'string' ||
      typeof payload.sessionId !== 'string'
    ) {
      throw new UnauthorizedException('invalid_participant_token');
    }
    return {
      sub: payload.sub,
      sessionId: payload.sessionId,
      aud: 'participant',
    };
  }
}
