import { z } from 'zod';
import { userRoleEnum, type UserRole } from '../enums.js';

/**
 * Admin-only user management DTOs. Every route these back is restricted to
 * `role='admin'` and scoped to the caller's `orgId` — an admin can only see
 * and manage users inside their own organization.
 */

/** Body for `PATCH /admin/users/:id/role`. The only way to grant/revoke
 * `admin` or `team_lead` — never self-assignable via `/auth/register`. */
export const changeUserRoleSchema = z.object({
  role: userRoleEnum,
});
export type ChangeUserRoleDto = z.infer<typeof changeUserRoleSchema>;

/** A user row as listed in the admin panel (no password hash). */
export type AdminUserDto = {
  id: string;
  email: string;
  fullName: string | null;
  occupation: string | null;
  role: UserRole;
  /**
   * The company promo code this account registered with, or null for accounts
   * created before codes existed. Lets an admin see which intake someone came
   * in on without exposing anything about other tenants.
   */
  promoCode: string | null;
  createdAt: string | null;
};

/**
 * Result of `POST /admin/users/:id/reset-password`. `temporaryPassword` is
 * returned in plaintext exactly once — the API never stores or logs it, only
 * its argon2 hash. The admin is responsible for relaying it to the user.
 */
export type ResetPasswordResult = {
  id: string;
  temporaryPassword: string;
};
