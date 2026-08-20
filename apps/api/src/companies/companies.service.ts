import {
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { asc, eq, sql } from 'drizzle-orm';
import type {
  CompanyDto,
  CreatePromoCodeDto,
  PromoCodeDto,
  UpdateCompanyDto,
  UpdatePromoCodeDto,
} from '@lms/shared';

import { DRIZZLE, type Db } from '../db/db.module';
import { organizations, promoCodes, users } from '../db/schema';
import { PromoCodesService } from './promo-codes.service';

type PromoCodeRow = typeof promoCodes.$inferSelect;

/**
 * Manages the caller's own company and the promo codes that let people join
 * it. Every method takes `orgId` from the JWT and filters on it, so an admin
 * can only ever see and change their own tenant — issuing a code for someone
 * else's company is not expressible through this API.
 *
 * Creating a brand-new company is deliberately not here: that is a platform
 * operation, done with `npm run seed:company -w @lms/api`.
 */
@Injectable()
export class CompaniesService {
  constructor(
    @Inject(DRIZZLE) private readonly db: Db,
    private readonly codes: PromoCodesService,
  ) {}

  /** The caller's company with its codes and current headcount. */
  async getCompany(orgId: string): Promise<CompanyDto> {
    const [org] = await this.db
      .select()
      .from(organizations)
      .where(eq(organizations.id, orgId))
      .limit(1);
    if (!org) {
      throw new NotFoundException('company_not_found');
    }

    const [{ memberCount } = { memberCount: 0 }] = await this.db
      .select({ memberCount: sql<number>`count(*)::int` })
      .from(users)
      .where(eq(users.organizationId, orgId));

    const rows = await this.db
      .select()
      .from(promoCodes)
      .where(eq(promoCodes.organizationId, orgId))
      .orderBy(asc(promoCodes.createdAt));

    return {
      id: org.id,
      name: org.name,
      createdAt: org.createdAt ? org.createdAt.toISOString() : null,
      memberCount: Number(memberCount),
      promoCodes: rows.map(toPromoCodeDto),
    };
  }

  /** Rename the caller's own company. */
  async renameCompany(
    orgId: string,
    dto: UpdateCompanyDto,
  ): Promise<CompanyDto> {
    const [updated] = await this.db
      .update(organizations)
      .set({ name: dto.name })
      .where(eq(organizations.id, orgId))
      .returning({ id: organizations.id });
    if (!updated) {
      throw new NotFoundException('company_not_found');
    }
    return this.getCompany(orgId);
  }

  /**
   * Issue a code for the caller's company. An explicit `code` is accepted so
   * an admin can hand out something memorable; leaving it out mints a random
   * one, which is the usual path.
   */
  async createPromoCode(
    orgId: string,
    createdBy: string,
    dto: CreatePromoCodeDto,
  ): Promise<PromoCodeDto> {
    const code = dto.code ?? (await this.codes.generateUniqueCode());

    const [existing] = await this.db
      .select({ id: promoCodes.id })
      .from(promoCodes)
      .where(eq(promoCodes.code, code))
      .limit(1);
    if (existing) {
      // Codes are unique platform-wide because registration resolves a tenant
      // from the code alone — so a clash with *another* company's code has to
      // be refused, even though the admin cannot see that company.
      throw new ConflictException('promo_code_taken');
    }

    const [created] = await this.db
      .insert(promoCodes)
      .values({
        organizationId: orgId,
        code,
        label: dto.label ?? null,
        maxUses: dto.maxUses ?? null,
        expiresAt: dto.expiresAt ? new Date(dto.expiresAt) : null,
        createdBy,
      })
      .returning();
    return toPromoCodeDto(created);
  }

  /** Patch a code (typically to deactivate it); tenant-scoped. */
  async updatePromoCode(
    orgId: string,
    id: string,
    dto: UpdatePromoCodeDto,
  ): Promise<PromoCodeDto> {
    await this.assertCodeInOrg(id, orgId);

    const patch: Partial<typeof promoCodes.$inferInsert> = {};
    if (dto.isActive !== undefined) patch.isActive = dto.isActive;
    if (dto.label !== undefined) patch.label = dto.label;
    if (dto.maxUses !== undefined) patch.maxUses = dto.maxUses;
    if (dto.expiresAt !== undefined) {
      patch.expiresAt = dto.expiresAt ? new Date(dto.expiresAt) : null;
    }

    const [updated] = await this.db
      .update(promoCodes)
      .set(patch)
      .where(eq(promoCodes.id, id))
      .returning();
    return toPromoCodeDto(updated);
  }

  /**
   * Delete a code. Refused once anyone has registered with it — the link from
   * user → code is how an admin tells intakes apart, so a used code gets
   * deactivated instead.
   */
  async deletePromoCode(orgId: string, id: string): Promise<{ id: string }> {
    const row = await this.assertCodeInOrg(id, orgId);
    if (row.usesCount > 0) {
      throw new ConflictException('promo_code_in_use');
    }
    await this.db.delete(promoCodes).where(eq(promoCodes.id, id));
    return { id };
  }

  private async assertCodeInOrg(
    id: string,
    orgId: string,
  ): Promise<PromoCodeRow> {
    const [row] = await this.db
      .select()
      .from(promoCodes)
      .where(
        sql`${promoCodes.id} = ${id} and ${promoCodes.organizationId} = ${orgId}`,
      )
      .limit(1);
    if (!row) {
      throw new NotFoundException('promo_code_not_found');
    }
    return row;
  }
}

/** Row → DTO, resolving the "can this still be redeemed?" rules server-side. */
function toPromoCodeDto(row: PromoCodeRow): PromoCodeDto {
  const expired = row.expiresAt ? row.expiresAt.getTime() <= Date.now() : false;
  const exhausted = row.maxUses !== null && row.usesCount >= row.maxUses;
  return {
    id: row.id,
    code: row.code,
    label: row.label,
    isActive: row.isActive,
    maxUses: row.maxUses,
    usesCount: row.usesCount,
    expiresAt: row.expiresAt ? row.expiresAt.toISOString() : null,
    createdAt: row.createdAt ? row.createdAt.toISOString() : null,
    redeemable: row.isActive && !expired && !exhausted,
  };
}
