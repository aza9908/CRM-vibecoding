import {
  Inject,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { randomInt } from 'node:crypto';
import { and, eq, sql } from 'drizzle-orm';
import type { CreatePromoCodeDto, PromoCodeDto } from '@lms/shared';

import { DRIZZLE, type Db } from '../db/db.module';
import { promoCodes } from '../db/schema';

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
    const code = await this.generateUniqueCode();
    const [row] = await this.db
      .insert(promoCodes)
      .values({
        organizationId: orgId,
        createdBy,
        code,
        maxUses: dto.maxUses ?? null,
        expiresAt: dto.expiresAt ? new Date(dto.expiresAt) : null,
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
    createdAt: row.createdAt ? row.createdAt.toISOString() : null,
  };
}
