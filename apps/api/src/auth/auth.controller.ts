import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Query,
  Req,
  Res,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request, Response } from 'express';
import {
  forgotPasswordSchema,
  loginSchema,
  registerSchema,
  resetPasswordSchema,
  type AuthResult,
  type AuthUserPayload,
  type ForgotPasswordDto,
  type LoginDto,
  type MessageResult,
  type PublicUser,
  type RegisterDto,
  type ResetPasswordDto,
  type ResetTokenStatus,
} from '@lms/shared';

import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { AuthService } from './auth.service';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { CurrentUser } from './decorators/current-user.decorator';

/** Cookie name carrying the rotating refresh token. */
const REFRESH_COOKIE = 'refresh_token';
/** 30 days in milliseconds — matches the refresh token TTL. */
const REFRESH_COOKIE_MAX_AGE = 30 * 24 * 60 * 60 * 1000;

@Controller('auth')
export class AuthController {
  private readonly isProd: boolean;

  constructor(
    private readonly auth: AuthService,
    config: ConfigService,
  ) {
    this.isProd = config.get<string>('NODE_ENV') === 'production';
  }

  /**
   * Register a new account (creates an organization + user). Sets the refresh
   * token as an httpOnly cookie and also returns both tokens in the body so the
   * web client can hold the access token in memory.
   */
  @Post('register')
  @HttpCode(HttpStatus.CREATED)
  async register(
    @Body(new ZodValidationPipe(registerSchema)) dto: RegisterDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AuthResult> {
    const result = await this.auth.register(dto);
    this.setRefreshCookie(res, result.refreshToken);
    return result;
  }

  /** Authenticate with email + password. */
  @Post('login')
  @HttpCode(HttpStatus.OK)
  async login(
    @Body(new ZodValidationPipe(loginSchema)) dto: LoginDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AuthResult> {
    const result = await this.auth.login(dto);
    this.setRefreshCookie(res, result.refreshToken);
    return result;
  }

  /**
   * Rotate tokens using the refresh token from the httpOnly cookie (falling
   * back to a body field for non-browser clients).
   */
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  async refresh(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @Body() body: { refreshToken?: string } | undefined,
  ): Promise<AuthResult> {
    const cookies = (req as Request & { cookies?: Record<string, string> })
      .cookies;
    const token = cookies?.[REFRESH_COOKIE] ?? body?.refreshToken;
    if (!token) {
      throw new UnauthorizedException('missing_refresh_token');
    }
    const result = await this.auth.refresh(token);
    this.setRefreshCookie(res, result.refreshToken);
    return result;
  }

  /**
   * Start a password reset.
   *
   * Always 202, never 404 — the response must be identical for registered and
   * unregistered addresses so it cannot be used to enumerate accounts.
   */
  @Post('forgot-password')
  @HttpCode(HttpStatus.ACCEPTED)
  async forgotPassword(
    @Body(new ZodValidationPipe(forgotPasswordSchema)) dto: ForgotPasswordDto,
    @Req() req: Request,
  ): Promise<MessageResult> {
    const ip =
      (req.headers['x-forwarded-for'] as string | undefined)
        ?.split(',')[0]
        ?.trim() ?? req.socket?.remoteAddress;

    await this.auth.requestPasswordReset(dto, ip);

    return { message: 'reset_email_sent' };
  }

  /**
   * Check a reset link before rendering the form, so an expired link shows a
   * proper message rather than failing after the user types a new password.
   */
  @Get('reset-password/validate')
  @HttpCode(HttpStatus.OK)
  async validateResetToken(
    @Query('token') token?: string,
  ): Promise<ResetTokenStatus> {
    return { valid: await this.auth.validateResetToken(token ?? '') };
  }

  /** Complete a password reset with a single-use token. */
  @Post('reset-password')
  @HttpCode(HttpStatus.OK)
  async resetPassword(
    @Body(new ZodValidationPipe(resetPasswordSchema)) dto: ResetPasswordDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<MessageResult> {
    await this.auth.resetPassword(dto);

    // A completed reset should not leave an old session alive on this device.
    res.clearCookie(REFRESH_COOKIE, { path: '/' });

    return { message: 'password_reset_ok' };
  }

  /** Return the current user's public profile. */
  @Get('me')
  @UseGuards(JwtAuthGuard)
  me(@CurrentUser() user: AuthUserPayload): Promise<PublicUser> {
    return this.auth.me(user.sub);
  }

  /** Persist the refresh token as an httpOnly (and Secure in prod) cookie. */
  private setRefreshCookie(res: Response, token: string): void {
    res.cookie(REFRESH_COOKIE, token, {
      httpOnly: true,
      secure: this.isProd,
      sameSite: 'lax',
      path: '/',
      maxAge: REFRESH_COOKIE_MAX_AGE,
    });
  }
}
