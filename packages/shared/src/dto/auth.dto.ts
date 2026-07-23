import { z } from 'zod';
import { userRoleEnum, type UserRole } from '../enums.js';

/**
 * Auth DTOs and the JWT payload shapes shared between web and api.
 *
 * Two JWT audiences are modelled and MUST NOT be conflated:
 *  - `AuthUserPayload`     — a real account (aud=user): teacher/student/admin/team_lead.
 *  - `ParticipantPayload`  — a session guest joined by code (aud=participant).
 */

/** Body for `POST /auth/register`. Creates an organization + user. */
export const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  fullName: z.string().min(1),
  role: userRoleEnum.optional(),
});
export type RegisterDto = z.infer<typeof registerSchema>;

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
  role: UserRole;
  organizationId: string | null;
};

/** Result returned by register/login/refresh. */
export type AuthResult = {
  accessToken: string;
  refreshToken: string;
  user: PublicUser;
};
