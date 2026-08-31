import {
  Inject,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { randomInt } from 'node:crypto';
import { and, asc, eq, sql } from 'drizzle-orm';
import type {
  CompanyCodeDto,
  CreateCompanyDto,
  CreatePromoCodeDto,
  PromoCodeDto,
} from '@lms/shared';

import { DRIZZLE, type Db } from '../db/db.module';
import { organizations, promoCodes } from '../db/schema';

/** Same ambiguity-free alphabet as live session codes; longer since these are
 * long-lived and typed by hand at signup rather than a 4-hour session join. */
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const CODE_LENGTH = 8;
const CODE_GEN_ATTEMPTS = 5;

type PromoCodeRow = typeof promoCodes.$inferSelect;

/**
 * Company promo codes: admin-issued, joined at registration (see
 * `AuthService.register`). Multi-use by default; an admin may cap `maxUses`
 * and/or set an expiry. Revoking sets `active=false` rather than deleting, so
 * usage history survives — a fresh code can reuse the same string once the
 * revoked row no longer holds the partial unique index.
 */
@Injectable()
export class PromoCodesService {
  constructor(@Inject(DRIZZLE) private readonly db: Db) {}

  /** List every promo code issued by `orgId`, newest first is not required —
   * order by creation for a stable admin view. */
  async listForOrg(orgId: string): Promise<PromoCodeDto[]> {
    const rows = await this.db
      .select()
      .from(promoCodes)
      .where(eq(promoCodes.organizationId, orgId))
      .orderBy(promoCodes.createdAt);
    return rows.map(toDto);
  }

  /** Create a new active code for `orgId`. */
  async create(
    orgId: string,
    createdBy: string,
    dto: CreatePromoCodeDto,
  ): Promise<PromoCodeDto> {
    return this.createInTx(this.db, orgId, createdBy, dto);
  }

  /**
   * Same as `create`, but runs against a caller-supplied db/transaction
   * handle — used by `AuthService.register()` so a brand-new company's first
   * promo code is created atomically with its founding account, in the same
   * transaction as the org + user insert.
   */
  async createInTx(
    db: Db,
    orgId: string,
    createdBy: string,
    dto: CreatePromoCodeDto = {},
  ): Promise<PromoCodeDto> {
    const code = await this.generateUniqueCode();
    const [row] = await db
      .insert(promoCodes)
      .values({
        organizationId: orgId,
        createdBy,
        code,
        maxUses: dto.maxUses ?? null,
        expiresAt: dto.expiresAt ? new Date(dto.expiresAt) : null,
        label: dto.label ?? null,
      })
      .returning();
    return toDto(row);
  }

  /** Revoke a code so it can no longer be used to join `orgId`. Tenant-scoped:
   * 404 (not 403) if the code belongs to another org, per project convention. */
  async revoke(orgId: string, id: string): Promise<void> {
    const [row] = await this.db
      .update(promoCodes)
      .set({ active: false })
      .where(and(eq(promoCodes.id, id), eq(promoCodes.organizationId, orgId)))
      .returning({ id: promoCodes.id });
    if (!row) throw new NotFoundException('promo_code_not_found');
  }

  /**
   * Permanently remove a code — unlike `revoke`, no row survives at all.
   * Safe to hard-delete: nothing else in the schema has a foreign key onto
   * `promo_codes.id` (a join only ever copies the resolved `organization_id`
   * onto the new user, never the code row itself), so there's no usage
   * history or audit trail tied to this id to lose. Tenant-scoped like
   * `revoke`: 404 if the code belongs to another org.
   */
  async remove(orgId: string, id: string): Promise<void> {
    const [row] = await this.db
      .delete(promoCodes)
      .where(and(eq(promoCodes.id, id), eq(promoCodes.organizationId, orgId)))
      .returning({ id: promoCodes.id });
    if (!row) throw new NotFoundException('promo_code_not_found');
  }

  /**
   * Resolve a raw code to the organization it grants access to, incrementing
   * its use count in the same atomic statement. Must be called with the
   * caller's registration transaction handle (`tx`) so two concurrent
   * registrations racing a code at its last remaining use can never both
   * succeed — the conditional `WHERE` re-checks `maxUses` against the
   * DB-current `use_count`, not a value read earlier in JS.
   *
   * Returns `null` if the code is unknown, inactive, expired, or exhausted.
   */
  async resolveForJoin(tx: Db, rawCode: string): Promise<string | null> {
    const normalized = rawCode.trim().toUpperCase();
    const result = await tx.execute<{ organization_id: string }>(sql`
      UPDATE promo_codes
      SET use_count = use_count + 1
      WHERE code = ${normalized}
        AND active = true
        AND (expires_at IS NULL OR expires_at > now())
        AND (max_uses IS NULL OR use_count < max_uses)
      RETURNING organization_id
    `);
    return result.rows[0]?.organization_id ?? null;
  }

  /**
   * Return `orgId`'s current active code, creating one if it doesn't have
   * one yet. Used by the platform-admin cross-org view so every company
   * always has a code to hand out, without anyone having to remember to
   * click "create" for each new signup.
   */
  private async getOrCreateActiveCode(
    orgId: string,
    fallbackCreatedBy: string,
  ): Promise<PromoCodeDto> {
    const [existing] = await this.db
      .select()
      .from(promoCodes)
      .where(and(eq(promoCodes.organizationId, orgId), eq(promoCodes.active, true)))
      .orderBy(promoCodes.createdAt)
      .limit(1);
    if (existing) return toDto(existing);
    return this.createInTx(this.db, orgId, fallbackCreatedBy);
  }

  /**
   * Revoke every active code for `orgId` and issue a fresh one — for when a
   * company's existing code needs to be reissued (e.g. it leaked or someone
   * lost it). Only the platform admin can call this (see `PlatformController`).
   */
  async regenerate(orgId: string, byUserId: string): Promise<PromoCodeDto> {
    await this.db
      .update(promoCodes)
      .set({ active: false })
      .where(and(eq(promoCodes.organizationId, orgId), eq(promoCodes.active, true)));
    return this.createInTx(this.db, orgId, byUserId);
  }

  /**
   * Every organization in the system, each paired with its current active
   * promo code (auto-created on first access). Platform-admin only — this is
   * the one place codes are visible across tenants instead of scoped to a
   * single `orgId`, so it must never be reachable through the regular
   * `RolesGuard` path (see `PlatformAdminGuard`).
   */
  async listAllCompaniesWithCodes(requestedBy: string): Promise<CompanyCodeDto[]> {
    const orgs = await this.db
      .select({ id: organizations.id, name: organizations.name })
      .from(organizations)
      .orderBy(asc(organizations.name));

    const result: CompanyCodeDto[] = [];
    for (const org of orgs) {
      const code = await this.getOrCreateActiveCode(org.id, requestedBy);
      result.push({ organizationId: org.id, organizationName: org.name, code });
    }
    return result;
  }

  /**
   * Add a company to the catalog (TZ §4.1) and issue its first promo code in
   * the same transaction, so it's immediately usable — mirrors the day-one
   * code every self-registered org used to get before §5.2 removed that
   * path. Platform-admin only (see `PlatformController`); there is no
   * per-org "create my own company" endpoint by design.
   */
  async createCompany(dto: CreateCompanyDto, createdBy: string): Promise<CompanyCodeDto> {
    const result = await this.db.transaction(async (tx) => {
      const [org] = await tx
        .insert(organizations)
        .values({
          name: dto.name,
          contactName: dto.contactName ?? null,
          contactEmail: dto.contactEmail ?? null,
          contactPhone: dto.contactPhone ?? null,
          notes: dto.notes ?? null,
          createdBy,
        })
        .returning();
      const code = await this.createInTx(tx, org.id, createdBy);
      return { organizationId: org.id, organizationName: org.name, code };
    });
    return result;
  }

  private randomCode(): string {
    let code = '';
    for (let i = 0; i < CODE_LENGTH; i++) {
      code += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
    }
    return code;
  }

  private async generateUniqueCode(): Promise<string> {
    for (let i = 0; i < CODE_GEN_ATTEMPTS; i++) {
      const code = this.randomCode();
      const clash = await this.db.query.promoCodes.findFirst({
        where: and(eq(promoCodes.code, code), eq(promoCodes.active, true)),
      });
      if (!clash) return code;
    }
    throw new InternalServerErrorException('promo_code_gen_failed');
  }
}

function toDto(row: PromoCodeRow): PromoCodeDto {
  return {
    id: row.id,
    code: row.code,
    active: row.active,
    maxUses: row.maxUses,
    useCount: row.useCount,
    expiresAt: row.expiresAt ? row.expiresAt.toISOString() : null,
    label: row.label,
    createdAt: row.createdAt ? row.createdAt.toISOString() : null,
  };
}
