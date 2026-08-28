import { z } from 'zod';
import type { UserRole } from '../enums.js';

/**
 * Auth DTOs and the JWT payload shapes shared between web and api.
 *
 * Two JWT audiences are modelled and MUST NOT be conflated:
 *  - `AuthUserPayload`     — a real account (aud=user): teacher/student/admin/team_lead/methodist.
 *  - `ParticipantPayload`  — a session guest joined by code (aud=participant).
 */

/**
 * Body for `POST /auth/register`. Per TZ_LMS_roles_promocodes.md §5.2/§12:
 * self-registration always creates a `student` account with no company of
 * its own — there is no "create a new company" path and no role picker here.
 * `promoCode` is optional: supplying a valid one attaches the account to
 * that company immediately; omitting it leaves `organizationId` null (the
 * user sees an empty state and can redeem a code later via
 * `POST /auth/redeem-promo-code`). `companyName`/`role` are deliberately not
 * fields on this schema — any extra key a client sends is silently stripped
 * by zod's default object parsing, satisfying acceptance criterion §14.12
 * ("a role passed in the request is ignored by the server").
 */
export const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  fullName: z.string().min(1),
  promoCode: z.string().min(1).optional(),
  occupation: z.string().min(1),
});
export type RegisterDto = z.infer<typeof registerSchema>;

/** Body for `POST /auth/redeem-promo-code` — an already-registered user
 * (typically one with no company yet) attaches a promo code to their own
 * account. Same resolution rules as at registration (§4.3). */
export const redeemPromoCodeSchema = z.object({
  promoCode: z.string().min(1),
});
export type RedeemPromoCodeDto = z.infer<typeof redeemPromoCodeSchema>;

/** Body for `POST /auth/login`. */
export const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});
export type LoginDto = z.infer<typeof loginSchema>;

/**
 * Body for `POST /auth/forgot-password`.
 *
 * Always answered with 202 regardless of whether the address exists — the
 * response must never reveal which emails are registered.
 */
export const forgotPasswordSchema = z.object({
  email: z.string().email(),
});
export type ForgotPasswordDto = z.infer<typeof forgotPasswordSchema>;

/**
 * Body for `POST /auth/reset-password`.
 *
 * `token` is the raw single-use value from the reset email; the server stores
 * only its hash. The confirmation field is checked here so the client can show
 * a field-level error without a round trip.
 */
export const resetPasswordSchema = z
  .object({
    token: z.string().min(16),
    password: z.string().min(8),
    confirmPassword: z.string().min(8),
  })
  .refine((v) => v.password === v.confirmPassword, {
    message: 'passwords_do_not_match',
    path: ['confirmPassword'],
  });
export type ResetPasswordDto = z.infer<typeof resetPasswordSchema>;

/** Body for `GET /auth/reset-password/validate?token=…` responses. */
export type ResetTokenStatus = {
  valid: boolean;
};

/** Generic acknowledgement returned by the password-reset endpoints. */
export type MessageResult = {
  message: string;
};

/**
 * Decoded access-token payload for a real account.
 * `aud` is optional/`'user'` to distinguish from participant tokens.
 */
export type AuthUserPayload = {
  sub: string;
  role: UserRole;
  orgId: string;
  aud?: 'user';
  /** Platform-wide operator: sees/issues promo codes across every org. */
  isPlatformAdmin?: boolean;
};

/**
 * Decoded token payload for a session guest who joined by code.
 * Grants access only to the one session it was issued for.
 */
export type ParticipantPayload = {
  sub: string;
  sessionId: string;
  aud: 'participant';
};

/** A user safe to expose to clients (no password hash). */
export type PublicUser = {
  id: string;
  email: string;
  fullName: string | null;
  occupation: string | null;
  role: UserRole;
  organizationId: string | null;
  /** Platform-wide operator: sees/issues promo codes across every org. */
  isPlatformAdmin: boolean;
};

/** Result returned by register/login/refresh. */
export type AuthResult = {
  accessToken: string;
  refreshToken: string;
  user: PublicUser;
};
