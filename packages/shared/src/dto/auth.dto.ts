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
