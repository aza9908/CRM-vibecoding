import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomInt } from 'node:crypto';
import * as argon2 from 'argon2';
import type {
  AdminUserDto,
  CreateUserDto,
  CreateUserResult,
  ResetPasswordResult,
  UserRole,
} from '@lms/shared';

import { UsersService } from '../users/users.service';

/** Characters used for generated temporary passwords — no 0/O/1/I/l to avoid
 * transcription mistakes when an admin reads one out loud or over chat. */
const PASSWORD_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
const PASSWORD_LENGTH = 12;

/** Admin-only user management: list/role-change/password-reset, all scoped
 * to the caller's organization (enforced by every method taking `orgId`). */
@Injectable()
export class AdminService {
  constructor(private readonly users: UsersService) {}

  /**
   * Create an account directly in the caller's org — for onboarding a
   * teacher/methodist, or a student who can't self-register some other way.
   * Admin-only (enforced at the controller with `@Roles('admin')`, not the
   * wider teacher/methodist/admin group everything else here uses): minting
   * new accounts with a chosen role is a stronger action than the
   * role-change/reset-password guards already carve out for admin-touching
   * cases, so it stays admin-exclusive across the board, not just for the
   * `admin` role choice (which isn't even offered here — see
   * `createUserRoleEnum`).
   */
  async createUser(orgId: string, dto: CreateUserDto): Promise<CreateUserResult> {
    const existing = await this.users.findByEmail(dto.email);
    if (existing) {
      throw new ConflictException('email_taken');
    }

    const temporaryPassword = generatePassword();
    const passwordHash = await argon2.hash(temporaryPassword, {
      type: argon2.argon2id,
    });
    const created = await this.users.create({
      email: dto.email,
      passwordHash,
      fullName: dto.fullName,
      role: dto.role,
      organizationId: orgId,
    });

    return {
      id: created.id,
      email: created.email,
      fullName: created.fullName,
      role: created.role,
      temporaryPassword,
    };
  }

  async listUsers(orgId: string): Promise<AdminUserDto[]> {
    const rows = await this.users.listByOrg(orgId);
    return rows.map((u) => ({
      id: u.id,
      email: u.email,
      fullName: u.fullName,
      role: u.role,
      createdAt: u.createdAt ? u.createdAt.toISOString() : null,
    }));
  }

  /**
   * Change a user's role within the caller's org. This is the ONLY way to
   * grant `admin` / `team_lead` — see `registerSchema` (`@lms/shared`), which
   * deliberately excludes those from public self-registration.
   *
   * Teacher/Methodist/Admin have identical permissions everywhere else in
   * this controller (TZ_LMS_roles_promocodes.md §3.1), but granting `admin`
   * or touching an existing admin's role is the one exception the doc's own
   * recommended default carves out (§3.2, §15 Q1): only an acting `admin`
   * may do either, so a teacher/methodist can't self-escalate or demote the
   * platform owner.
   */
  async changeRole(
    orgId: string,
    userId: string,
    actingUserId: string,
    actingUserRole: UserRole,
    role: UserRole,
  ): Promise<AdminUserDto> {
    if (userId === actingUserId) {
      // An admin locking themselves out of the only admin account in their
      // org is an easy accident (typo-select a role, submit) with no
      // recovery path short of a DB console — simplest guard is to disallow
      // self-edits here entirely; ask another admin to do it instead.
      throw new NotFoundException('cannot_change_own_role');
    }

    const target = await this.users.findByIdInOrg(userId, orgId);
    if (!target) {
      throw new NotFoundException('user_not_found');
    }
    if ((role === 'admin' || target.role === 'admin') && actingUserRole !== 'admin') {
      throw new ForbiddenException('only_admin_can_manage_admin_role');
    }

    const updated = await this.users.updateRole(userId, orgId, role);
    if (!updated) {
      throw new NotFoundException('user_not_found');
    }
    return {
      id: updated.id,
      email: updated.email,
      fullName: updated.fullName,
      role: updated.role,
      createdAt: updated.createdAt ? updated.createdAt.toISOString() : null,
    };
  }

  /**
   * Generate a fresh random password for a user, hash it, persist the hash,
   * and return the plaintext exactly once so the admin can relay it. Nothing
   * plaintext is stored or logged.
   *
   * Same admin-target guard as `changeRole`: a teacher/methodist resetting
   * an admin's password would be an equivalent takeover of that account, so
   * it's restricted the same way — only an acting admin can reset another
   * admin's password.
   */
  async resetPassword(
    orgId: string,
    userId: string,
    actingUserRole: UserRole,
  ): Promise<ResetPasswordResult> {
    const target = await this.users.findByIdInOrg(userId, orgId);
    if (!target) {
      throw new NotFoundException('user_not_found');
    }
    if (target.role === 'admin' && actingUserRole !== 'admin') {
      throw new ForbiddenException('only_admin_can_manage_admin_role');
    }

    const temporaryPassword = generatePassword();
    const passwordHash = await argon2.hash(temporaryPassword, {
      type: argon2.argon2id,
    });
    const updated = await this.users.updatePasswordHash(
      userId,
      orgId,
      passwordHash,
    );
    if (!updated) {
      throw new NotFoundException('user_not_found');
    }
    return { id: updated.id, temporaryPassword };
  }
}

function generatePassword(): string {
  let out = '';
  for (let i = 0; i < PASSWORD_LENGTH; i++) {
    out += PASSWORD_ALPHABET[randomInt(PASSWORD_ALPHABET.length)];
  }
  return out;
}
