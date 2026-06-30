import { Inject, Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import type { PublicUser, UserRole } from '@lms/shared';

import { DRIZZLE, type Db } from '../db/db.module';
import { users } from '../db/schema';

/** A user row as stored in the database (including the password hash). */
export type UserRecord = {
  id: string;
  organizationId: string | null;
  email: string;
  passwordHash: string | null;
  fullName: string | null;
  avatarUrl: string | null;
  role: UserRole;
  createdAt: Date | null;
};

/** Fields accepted when creating a user inside an existing organization. */
export interface CreateUserInput {
  email: string;
  passwordHash: string;
  fullName: string;
  role?: UserRole;
  organizationId: string;
}

/**
 * Read/write access to the `users` table.
 *
 * Lookups by email are global (email is unique across the platform), which is
 * required for login/registration. Every other consumer of user data must scope
 * by `organizationId` itself — this service intentionally does not leak rows
 * across tenants for any org-scoped query.
 */
@Injectable()
export class UsersService {
  constructor(@Inject(DRIZZLE) private readonly db: Db) {}

  /**
   * Find a user by email (case-sensitive, matching the unique index). Returns
   * the full record including the password hash for credential verification.
   */
  async findByEmail(email: string): Promise<UserRecord | null> {
    const row = await this.db.query.users.findFirst({
      where: eq(users.email, email),
    });
    return (row as UserRecord | undefined) ?? null;
  }

  /** Find a user by id. Returns the full record including the password hash. */
  async findById(id: string): Promise<UserRecord | null> {
    const row = await this.db.query.users.findFirst({
      where: eq(users.id, id),
    });
    return (row as UserRecord | undefined) ?? null;
  }

  /**
   * Find a user by id, scoped to an organization. Use this whenever an
   * authenticated request resolves another user — it guarantees tenant
   * isolation by refusing to return rows from a different org.
   */
  async findByIdInOrg(id: string, orgId: string): Promise<UserRecord | null> {
    const row = await this.db.query.users.findFirst({
      where: (u, { and }) => and(eq(u.id, id), eq(u.organizationId, orgId)),
    });
    return (row as UserRecord | undefined) ?? null;
  }

  /** Insert a new user into an existing organization. */
  async create(input: CreateUserInput): Promise<UserRecord> {
    const [row] = await this.db
      .insert(users)
      .values({
        email: input.email,
        passwordHash: input.passwordHash,
        fullName: input.fullName,
        role: input.role ?? 'student',
        organizationId: input.organizationId,
      })
      .returning();
    return row as UserRecord;
  }

  /** Project a stored user row down to the client-safe `PublicUser` shape. */
  toPublicUser(user: UserRecord): PublicUser {
    return {
      id: user.id,
      email: user.email,
      fullName: user.fullName,
      role: user.role,
      organizationId: user.organizationId,
    };
  }

  /** Find a user by id and return the client-safe projection, or null. */
  async getPublicById(id: string): Promise<PublicUser | null> {
    const user = await this.findById(id);
    return user ? this.toPublicUser(user) : null;
  }
}
