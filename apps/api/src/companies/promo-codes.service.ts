import { Inject, Injectable } from '@nestjs/common';
import { randomInt } from 'node:crypto';
import { and, eq, isNull, or, sql } from 'drizzle-orm';
import {
  PROMO_CODE_ALPHABET,
  PROMO_CODE_LENGTH,
  type PromoCodeLookup,
} from '@lms/shared';

import { DRIZZLE, type Db } from '../db/db.module';
import { organizations, promoCodes } from '../db/schema';

/** Outcome of trying to redeem a code during registration. */
export type RedeemResult =
  | { ok: true; organizationId: string; promoCodeId: string }
  | { ok: false; reason: 'not_found' | 'inactive' | 'expired' | 'exhausted' };

/**
 * Issues and redeems company promo codes.
 *
 * Deliberately free of any dependency on `AuthModule`: registration needs to
 * redeem a code, and the admin controller that issues codes needs the auth
 * guards, so keeping redemption in its own module is what stops those two from
 * forming an import cycle.
 */
@Injectable()
export class PromoCodesService {
  constructor(@Inject(DRIZZLE) private readonly db: Db) {}

  /** A random code from the unambiguous alphabet (no O/0, no I/1/L). */
  generateCode(length = PROMO_CODE_LENGTH): string {
    let out = '';
    for (let i = 0; i < length; i++) {
      out += PROMO_CODE_ALPHABET[randomInt(PROMO_CODE_ALPHABET.length)];
    }
    return out;
  }

  /**
   * Mint a code that is not already taken. The unique index is still the real
   * guarantee; retrying here just keeps the common case from surfacing as an
   * error to the admin (same approach as live-session join codes).
   */
  async generateUniqueCode(): Promise<string> {
    for (let attempt = 0; attempt < 8; attempt++) {
      const code = this.generateCode();
      const [taken] = await this.db
        .select({ id: promoCodes.id })
        .from(promoCodes)
        .where(eq(promoCodes.code, code))
        .limit(1);
      if (!taken) return code;
    }
    // 31^8 keyspace: eight collisions in a row means something is very wrong,
    // so fall back to a longer code rather than looping forever.
    return this.generateCode(PROMO_CODE_LENGTH + 4);
  }

  /**
   * Public pre-check for the signup form: does this code exist, and which
   * company does it belong to? Returns `{ valid: false }` with no company name
   * for anything unusable, so a wrong guess never reveals a tenant.
   */
  async lookup(code: string): Promise<PromoCodeLookup> {
    const [row] = await this.db
      .select({
        companyName: organizations.name,
      })
      .from(promoCodes)
      .innerJoin(
        organizations,
        eq(organizations.id, promoCodes.organizationId),
      )
      .where(and(eq(promoCodes.code, code), this.redeemableCondition()))
      .limit(1);

    return row ? { valid: true, companyName: row.companyName } : { valid: false };
  }

  /**
   * Claim one use of a code, returning the company it belongs to.
   *
   * The claim is a single conditional `UPDATE … RETURNING`, so two people
   * registering at the same instant can never both take the last use of a
   * capped code. A separate read afterwards explains *why* a claim failed,
   * which only runs on the error path.
   */
  async redeem(code: string): Promise<RedeemResult> {
    const [claimed] = await this.db
      .update(promoCodes)
      .set({ usesCount: sql`${promoCodes.usesCount} + 1` })
      .where(and(eq(promoCodes.code, code), this.redeemableCondition()))
      .returning({
        id: promoCodes.id,
        organizationId: promoCodes.organizationId,
      });

    if (claimed) {
      return {
        ok: true,
        organizationId: claimed.organizationId,
        promoCodeId: claimed.id,
      };
    }

    const [existing] = await this.db
      .select({
        isActive: promoCodes.isActive,
        maxUses: promoCodes.maxUses,
        usesCount: promoCodes.usesCount,
        expiresAt: promoCodes.expiresAt,
      })
      .from(promoCodes)
      .where(eq(promoCodes.code, code))
      .limit(1);

    if (!existing) return { ok: false, reason: 'not_found' };
    if (!existing.isActive) return { ok: false, reason: 'inactive' };
    if (existing.expiresAt && existing.expiresAt.getTime() <= Date.now()) {
      return { ok: false, reason: 'expired' };
    }
    return { ok: false, reason: 'exhausted' };
  }

  /** Give a use back — used when the surrounding registration fails. */
  async releaseUse(promoCodeId: string): Promise<void> {
    await this.db
      .update(promoCodes)
      .set({
        usesCount: sql`greatest(${promoCodes.usesCount} - 1, 0)`,
      })
      .where(eq(promoCodes.id, promoCodeId));
  }

  /** Active, unexpired, and with uses left — the three rules in one place. */
  private redeemableCondition() {
    return and(
      eq(promoCodes.isActive, true),
      or(
        isNull(promoCodes.expiresAt),
        sql`${promoCodes.expiresAt} > now()`,
      ),
      or(
        isNull(promoCodes.maxUses),
        sql`${promoCodes.usesCount} < ${promoCodes.maxUses}`,
      ),
    );
  }
}
