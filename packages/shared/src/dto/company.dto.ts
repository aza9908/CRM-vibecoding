import { z } from 'zod';

/**
 * Company (organization) and promo-code DTOs.
 *
 * A promo code is how a user gets attached to a company: an admin issues one
 * or more codes for their organization, hands them to the company's people,
 * and `POST /auth/register` resolves the submitted code to an `organizationId`.
 * Signup can therefore never invent a new company out of a free-text field.
 */

/**
 * Alphabet for generated codes: uppercase letters + digits with the visually
 * ambiguous pairs removed (no O/0, no I/1/L), matching the session-code and
 * temporary-password alphabets already used elsewhere. Codes are read aloud
 * and retyped by hand, so ambiguity is a support cost.
 */
export const PROMO_CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

/** Length of an auto-generated promo code. */
export const PROMO_CODE_LENGTH = 8;

/**
 * A promo code as submitted by a human: trimmed, uppercased, and stripped of
 * the spaces and dashes people insert when copying from a slide or a chat
 * message. Storage is always the normalized form, so lookups are exact.
 */
export const promoCodeSchema = z
  .string()
  .trim()
  .min(4, 'promo_code_too_short')
  .max(32, 'promo_code_too_long')
  .transform((v) => v.replace(/[\s-]/g, '').toUpperCase())
  .pipe(
    z
      .string()
      .min(4)
      .regex(/^[A-Z0-9]+$/, 'promo_code_invalid_chars'),
  );

/**
 * Body for `POST /admin/company/promo-codes`.
 *
 * Every field is optional: with an empty body the API mints a random code with
 * no limits, which is the common case. `maxUses` caps how many accounts a code
 * can create (null = unlimited) and `expiresAt` closes it on a date.
 */
export const createPromoCodeSchema = z.object({
  /** Omit to have the server generate one. */
  code: promoCodeSchema.optional(),
  /** Free-text note for the admin, e.g. "поток Q1 2026". */
  label: z.string().trim().max(200).optional(),
  maxUses: z.number().int().positive().max(100_000).nullable().optional(),
  /** ISO date-time; the code stops working after it. */
  expiresAt: z.string().datetime({ offset: true }).nullable().optional(),
});
export type CreatePromoCodeDto = z.infer<typeof createPromoCodeSchema>;

/**
 * Body for `PATCH /admin/company/promo-codes/:id`. Codes are deactivated
 * rather than deleted whenever they have already been used, so the audit trail
 * from user → code survives.
 */
export const updatePromoCodeSchema = z.object({
  isActive: z.boolean().optional(),
  label: z.string().trim().max(200).nullable().optional(),
  maxUses: z.number().int().positive().max(100_000).nullable().optional(),
  expiresAt: z.string().datetime({ offset: true }).nullable().optional(),
});
export type UpdatePromoCodeDto = z.infer<typeof updatePromoCodeSchema>;

/** Body for `PATCH /admin/company` — rename the caller's own company. */
export const updateCompanySchema = z.object({
  name: z.string().trim().min(1).max(200),
});
export type UpdateCompanyDto = z.infer<typeof updateCompanySchema>;

/** A promo code as listed in the admin panel. */
export type PromoCodeDto = {
  id: string;
  code: string;
  label: string | null;
  isActive: boolean;
  maxUses: number | null;
  /** How many accounts have registered with this code. */
  usesCount: number;
  expiresAt: string | null;
  createdAt: string | null;
  /**
   * False when the code can no longer be redeemed — deactivated, expired, or
   * out of uses. Computed by the API so the UI never re-derives the rules.
   */
  redeemable: boolean;
};

/** The caller's own company plus its codes and headcount. */
export type CompanyDto = {
  id: string;
  name: string;
  createdAt: string | null;
  memberCount: number;
  promoCodes: PromoCodeDto[];
};

/**
 * Response of the public `GET /auth/promo-code/:code` lookup. Lets the signup
 * form confirm which company a code belongs to before the account is created,
 * so nobody discovers a typo only after registering into the wrong tenant.
 */
export type PromoCodeLookup = {
  valid: boolean;
  /** Present only when `valid` — never leaks a company name for a bad code. */
  companyName?: string;
};
