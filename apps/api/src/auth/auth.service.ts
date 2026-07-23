import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import * as argon2 from 'argon2';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { and, eq, gt, isNull, lt, or, sql } from 'drizzle-orm';
import type {
  AuthResult,
  AuthUserPayload,
  ForgotPasswordDto,
  LoginDto,
  ParticipantPayload,
  PublicUser,
  RegisterDto,
  ResetPasswordDto,
} from '@lms/shared';

import { DRIZZLE, type Db } from '../db/db.module';
import { organizations, passwordResetTokens, users } from '../db/schema';
import { UsersService, type UserRecord } from '../users/users.service';
import { MailService } from '../mail/mail.service';

/** Access token lifetime (short-lived; refreshed via the rotation flow). */
const ACCESS_TTL = '15m';
/** Refresh token lifetime (long-lived; set as an httpOnly cookie). */
const REFRESH_TTL = '30d';
/** Participant token lifetime (covers a live session sitting). */
const PARTICIPANT_TTL = '12h';
/** How long a password reset link stays usable. */
const RESET_TTL_MS = 60 * 60 * 1000; // 1 hour
/** Max reset requests honoured per account inside the throttle window. */
const RESET_MAX_PER_WINDOW = 3;
const RESET_WINDOW_MS = 15 * 60 * 1000;

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
  private readonly logger = new Logger(AuthService.name);
  private readonly accessSecret: string;
  private readonly refreshSecret: string;
  private readonly webOrigin: string;

  constructor(
    @Inject(DRIZZLE) private readonly db: Db,
    private readonly users: UsersService,
    private readonly jwt: JwtService,
    private readonly mail: MailService,
    config: ConfigService,
  ) {
    const access = config.get<string>('JWT_ACCESS_SECRET');
    const refresh = config.get<string>('JWT_REFRESH_SECRET');
    if (!access) throw new Error('JWT_ACCESS_SECRET is not set');
    if (!refresh) throw new Error('JWT_REFRESH_SECRET is not set');
    this.accessSecret = access;
    this.refreshSecret = refresh;
    this.webOrigin =
      config.get<string>('WEB_ORIGIN') ?? 'http://localhost:3000';
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

  // ── password recovery ───────────────────────────────────────────────────

  /**
   * Begin a password reset.
   *
   * Always resolves successfully, whatever the outcome. Returning 404 for
   * unknown addresses would turn this endpoint into an account-enumeration
   * oracle, so the caller gets the same acknowledgement either way and the real
   * branching happens silently here.
   */
  async requestPasswordReset(
    dto: ForgotPasswordDto,
    ip?: string,
  ): Promise<void> {
    const email = dto.email.trim().toLowerCase();
    const user = await this.users.findByEmail(email);

    // Unknown address, or an OAuth-only account with no password to reset.
    if (!user) {
      this.logger.debug(`reset requested for unknown address`);
      return;
    }

    // Per-account throttle: cheap defence against using the endpoint as a
    // mail bomb against a known address.
    const since = new Date(Date.now() - RESET_WINDOW_MS);
    const [{ count } = { count: 0 }] = await this.db
      .select({ count: sql<number>`count(*)::int` })
      .from(passwordResetTokens)
      .where(
        and(
          eq(passwordResetTokens.userId, user.id),
          gt(passwordResetTokens.createdAt, since),
        ),
      );

    if (count >= RESET_MAX_PER_WINDOW) {
      this.logger.warn(`reset throttled for user ${user.id}`);
      return;
    }

    // Invalidate any outstanding links so only the newest one works.
    await this.db
      .update(passwordResetTokens)
      .set({ usedAt: new Date() })
      .where(
        and(
          eq(passwordResetTokens.userId, user.id),
          isNull(passwordResetTokens.usedAt),
        ),
      );

    const rawToken = randomBytes(32).toString('base64url');
    const tokenHash = this.hashToken(rawToken);
    const expiresAt = new Date(Date.now() + RESET_TTL_MS);

    await this.db.insert(passwordResetTokens).values({
      userId: user.id,
      tokenHash,
      expiresAt,
      requestedIp: ip ?? null,
    });

    const resetUrl = `${this.webOrigin.replace(/\/+$/, '')}/reset-password?token=${rawToken}`;

    const sent = await this.mail.sendPasswordReset(
      user.email,
      resetUrl,
      Math.round(RESET_TTL_MS / 60000),
    );

    // Without a mail provider the link would be unreachable, so surface it in
    // the server log. Never do this once MAIL_API_URL is configured.
    if (!sent) {
      this.logger.warn(`PASSWORD RESET LINK (mail disabled): ${resetUrl}`);
    }
  }

  /**
   * Check a reset token without consuming it, so the reset page can show a
   * clear "link expired" state instead of failing only on submit.
   */
  async validateResetToken(token: string): Promise<boolean> {
    if (!token) return false;
    const row = await this.findLiveResetToken(token);
    return row !== null;
  }

  /**
   * Complete a password reset: verify the token, write the new hash, and burn
   * the token. Both writes happen in one transaction so a crash can never leave
   * a consumed token with an unchanged password (or the reverse).
   */
  async resetPassword(dto: ResetPasswordDto): Promise<void> {
    const row = await this.findLiveResetToken(dto.token);
    if (!row) {
      throw new BadRequestException('invalid_or_expired_token');
    }

    const user = await this.users.findById(row.userId);
    if (!user) {
      throw new BadRequestException('invalid_or_expired_token');
    }

    // Refuse a no-op reset — it usually means the user misread the email and
    // it would silently consume their only valid link.
    if (
      user.passwordHash &&
      (await argon2.verify(user.passwordHash, dto.password).catch(() => false))
    ) {
      throw new BadRequestException('password_unchanged');
    }

    const passwordHash = await argon2.hash(dto.password, {
      type: argon2.argon2id,
    });

    await this.db.transaction(async (tx) => {
      await tx
        .update(users)
        .set({ passwordHash })
        .where(eq(users.id, row.userId));

      await tx
        .update(passwordResetTokens)
        .set({ usedAt: new Date() })
        .where(eq(passwordResetTokens.id, row.id));

      // Any other outstanding link for this account is now stale too.
      await tx
        .update(passwordResetTokens)
        .set({ usedAt: new Date() })
        .where(
          and(
            eq(passwordResetTokens.userId, row.userId),
            isNull(passwordResetTokens.usedAt),
          ),
        );
    });

    this.logger.log(`password reset completed for user ${row.userId}`);
  }

  /**
   * Housekeeping: drop tokens that are long dead. Safe to call from a cron.
   */
  async purgeExpiredResetTokens(): Promise<number> {
    const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const deleted = await this.db
      .delete(passwordResetTokens)
      .where(
        or(
          lt(passwordResetTokens.expiresAt, cutoff),
          lt(passwordResetTokens.usedAt, cutoff),
        ),
      )
      .returning({ id: passwordResetTokens.id });
    return deleted.length;
  }

  /** SHA-256 of the raw token — what we actually persist. */
  private hashToken(raw: string): string {
    return createHash('sha256').update(raw).digest('hex');
  }

  /**
   * Look up an unused, unexpired token by its raw value.
   *
   * The hash lookup is indexed, and the extra `timingSafeEqual` guards against
   * leaking information through comparison timing on the returned row.
   */
  private async findLiveResetToken(
    raw: string,
  ): Promise<{ id: string; userId: string; tokenHash: string } | null> {
    const tokenHash = this.hashToken(raw);

    const row = await this.db.query.passwordResetTokens.findFirst({
      where: (t, { and: a, eq: e, gt: g, isNull: n }) =>
        a(e(t.tokenHash, tokenHash), n(t.usedAt), g(t.expiresAt, new Date())),
    });

    if (!row) return null;

    const a = Buffer.from(row.tokenHash, 'utf8');
    const b = Buffer.from(tokenHash, 'utf8');
    if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

    return { id: row.id, userId: row.userId, tokenHash: row.tokenHash };
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
