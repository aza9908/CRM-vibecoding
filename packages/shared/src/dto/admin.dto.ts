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

/** Roles an admin may hand out when creating an account directly. `admin`
 * is deliberately excluded — granting admin stays on the extra-guarded
 * `PATCH /admin/users/:id/role` path (`AdminService.changeRole`), never a
 * one-shot creation call. */
export const createUserRoleEnum = z.enum(['student', 'teacher', 'methodist']);
export type CreateUserRole = z.infer<typeof createUserRoleEnum>;

/**
 * Body for `POST /admin/users` — admin creates an account directly (instead
 * of the person self-registering with a promo code), e.g. onboarding a new
 * teacher or methodist, or a student who can't self-register for some
 * reason. Admin-only (TZ_LMS_roles_promocodes.md §3.2's role-escalation
 * carve-out applies here too — teacher/methodist cannot mint accounts).
 */
export const createUserSchema = z.object({
  email: z.string().email(),
  fullName: z.string().min(1),
  role: createUserRoleEnum,
});
export type CreateUserDto = z.infer<typeof createUserSchema>;

/** Result of `POST /admin/users` — same one-time-plaintext-password
 * convention as `ResetPasswordResult` below. */
export type CreateUserResult = {
  id: string;
  email: string;
  fullName: string | null;
  role: UserRole;
  temporaryPassword: string;
};

/** A user row as listed in the admin panel (no password hash). */
export type AdminUserDto = {
  id: string;
  email: string;
  fullName: string | null;
  role: UserRole;
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
