import { Injectable, NotFoundException } from '@nestjs/common';
import { randomInt } from 'node:crypto';
import * as argon2 from 'argon2';
import type { AdminUserDto, ResetPasswordResult, UserRole } from '@lms/shared';

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
   */
  async changeRole(
    orgId: string,
    userId: string,
    actingUserId: string,
    role: UserRole,
  ): Promise<AdminUserDto> {
    if (userId === actingUserId) {
      // An admin locking themselves out of the only admin account in their
      // org is an easy accident (typo-select a role, submit) with no
      // recovery path short of a DB console — simplest guard is to disallow
      // self-edits here entirely; ask another admin to do it instead.
      throw new NotFoundException('cannot_change_own_role');
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
   */
  async resetPassword(
    orgId: string,
    userId: string,
  ): Promise<ResetPasswordResult> {
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
