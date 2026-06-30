import {
  ConflictException,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import * as argon2 from 'argon2';
import type {
  AuthResult,
  AuthUserPayload,
  LoginDto,
  ParticipantPayload,
  PublicUser,
  RegisterDto,
} from '@lms/shared';

import { DRIZZLE, type Db } from '../db/db.module';
import { organizations, users } from '../db/schema';
import { UsersService, type UserRecord } from '../users/users.service';

/** Access token lifetime (short-lived; refreshed via the rotation flow). */
const ACCESS_TTL = '15m';
/** Refresh token lifetime (long-lived; set as an httpOnly cookie). */
const REFRESH_TTL = '30d';
/** Participant token lifetime (covers a live session sitting). */
const PARTICIPANT_TTL = '12h';

/** Claims carried by a refresh token (rotated on every use). */
interface RefreshClaims {
  sub: string;
  role: string;
  orgId: string;
  typ: 'refresh';
  aud?: 'user';
}

@Injectable()
export class AuthService {
  private readonly accessSecret: string;
  private readonly refreshSecret: string;

  constructor(
    @Inject(DRIZZLE) private readonly db: Db,
    private readonly users: UsersService,
    private readonly jwt: JwtService,
    config: ConfigService,
  ) {
    const access = config.get<string>('JWT_ACCESS_SECRET');
    const refresh = config.get<string>('JWT_REFRESH_SECRET');
    if (!access) throw new Error('JWT_ACCESS_SECRET is not set');
    if (!refresh) throw new Error('JWT_REFRESH_SECRET is not set');
    this.accessSecret = access;
    this.refreshSecret = refresh;
  }

  // ── public flows ────────────────────────────────────────────────────────

  /**
   * Register a new account. Creates a fresh organization and its first user in
   * a single transaction, then issues tokens. Email uniqueness is enforced
   * both by the unique index and an upfront check for a friendlier error.
   */
  async register(dto: RegisterDto): Promise<AuthResult> {
    const existing = await this.users.findByEmail(dto.email);
    if (existing) {
      throw new ConflictException('email_taken');
    }

    const passwordHash = await argon2.hash(dto.password, {
      type: argon2.argon2id,
    });

    const created = await this.db.transaction(async (tx) => {
      const [org] = await tx
        .insert(organizations)
        .values({ name: `${dto.fullName} workspace` })
        .returning();
      const [user] = await tx
        .insert(users)
        .values({
          email: dto.email,
          passwordHash,
          fullName: dto.fullName,
          role: dto.role ?? 'teacher',
          organizationId: org.id,
        })
        .returning();
      return user as UserRecord;
    });

    return this.issueTokens(created);
  }

  /** Verify email + password and issue tokens. */
  async login(dto: LoginDto): Promise<AuthResult> {
    const user = await this.users.findByEmail(dto.email);
    if (
      !user?.passwordHash ||
      !(await argon2.verify(user.passwordHash, dto.password))
    ) {
      throw new UnauthorizedException('bad_credentials');
    }
    return this.issueTokens(user);
  }

  /**
   * Rotate a refresh token: verify it, re-load the user (so role/org changes
   * and deletions take effect), and mint a brand-new access + refresh pair.
   */
  async refresh(token: string): Promise<AuthResult> {
    if (!token) {
      throw new UnauthorizedException('missing_refresh_token');
    }
    let claims: RefreshClaims;
    try {
      claims = this.jwt.verify<RefreshClaims>(token, {
        secret: this.refreshSecret,
      });
    } catch {
      throw new UnauthorizedException('invalid_refresh_token');
    }
    if (claims.typ !== 'refresh' || typeof claims.sub !== 'string') {
      throw new UnauthorizedException('invalid_refresh_token');
    }
    const user = await this.users.findById(claims.sub);
    if (!user) {
      throw new UnauthorizedException('user_not_found');
    }
    return this.issueTokens(user);
  }

  /** Return the client-safe profile for an authenticated user id. */
  async me(userId: string): Promise<PublicUser> {
    const user = await this.users.findById(userId);
    if (!user) {
      throw new UnauthorizedException('user_not_found');
    }
    return this.users.toPublicUser(user);
  }

  // ── token issuance ──────────────────────────────────────────────────────

  /**
   * Mint an access + refresh pair for a user and return them alongside the
   * public profile. The access token carries `{ sub, role, orgId, aud:'user' }`
   * — exactly what `JwtStrategy` and the org scoping layer expect.
   */
  issueTokens(user: UserRecord): AuthResult {
    const orgId = user.organizationId ?? '';
    const accessPayload: AuthUserPayload = {
      sub: user.id,
      role: user.role,
      orgId,
      aud: 'user',
    };
    const accessToken = this.jwt.sign(accessPayload, {
      secret: this.accessSecret,
      expiresIn: ACCESS_TTL,
    });
    const refreshPayload: RefreshClaims = {
      sub: user.id,
      role: user.role,
      orgId,
      typ: 'refresh',
      aud: 'user',
    };
    const refreshToken = this.jwt.sign(refreshPayload, {
      secret: this.refreshSecret,
      expiresIn: REFRESH_TTL,
    });
    return {
      accessToken,
      refreshToken,
      user: this.users.toPublicUser(user),
    };
  }

  /**
   * Sign a short-lived participant token for a session guest. Carries
   * `{ sub: participantId, sessionId, aud:'participant' }`. Signed with the
   * access secret but with a distinct audience so it can never authenticate as
   * a user (see `JwtStrategy`/`ParticipantStrategy`).
   */
  issueParticipantToken(participantId: string, sessionId: string): string {
    const payload: ParticipantPayload = {
      sub: participantId,
      sessionId,
      aud: 'participant',
    };
    return this.jwt.sign(payload, {
      secret: this.accessSecret,
      expiresIn: PARTICIPANT_TTL,
    });
  }

  // ── token verification (used by the realtime gateway) ────────────────────

  /** Verify a user access token, returning the typed payload or throwing. */
  verifyUserToken(token: string): AuthUserPayload {
    let claims: Record<string, unknown>;
    try {
      claims = this.jwt.verify<Record<string, unknown>>(token, {
        secret: this.accessSecret,
      });
    } catch {
      throw new UnauthorizedException('invalid_token');
    }
    if (
      claims.aud === 'participant' ||
      typeof claims.sub !== 'string' ||
      typeof claims.role !== 'string' ||
      typeof claims.orgId !== 'string'
    ) {
      throw new UnauthorizedException('wrong_audience');
    }
    return {
      sub: claims.sub,
      role: claims.role as AuthUserPayload['role'],
      orgId: claims.orgId,
      aud: 'user',
    };
  }

  /**
   * Verify a socket token that may be EITHER a user or a participant token, and
   * return the appropriately-shaped payload. Used by the WS gateway, which
   * accepts both audiences on the `/live` namespace.
   */
  async verifySocketToken(
    token: string,
  ): Promise<AuthUserPayload | ParticipantPayload> {
    if (!token) {
      throw new UnauthorizedException('missing_token');
    }
    let claims: Record<string, unknown>;
    try {
      claims = this.jwt.verify<Record<string, unknown>>(token, {
        secret: this.accessSecret,
      });
    } catch {
      throw new UnauthorizedException('invalid_token');
    }

    if (claims.aud === 'participant') {
      if (
        typeof claims.sub !== 'string' ||
        typeof claims.sessionId !== 'string'
      ) {
        throw new UnauthorizedException('invalid_participant_token');
      }
      return {
        sub: claims.sub,
        sessionId: claims.sessionId,
        aud: 'participant',
      };
    }

    if (
      typeof claims.sub !== 'string' ||
      typeof claims.role !== 'string' ||
      typeof claims.orgId !== 'string'
    ) {
      throw new UnauthorizedException('invalid_token');
    }
    return {
      sub: claims.sub,
      role: claims.role as AuthUserPayload['role'],
      orgId: claims.orgId,
      aud: 'user',
    };
  }
}
