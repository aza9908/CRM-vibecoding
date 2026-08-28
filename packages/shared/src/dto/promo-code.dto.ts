import { z } from 'zod';

/**
 * Company promo codes (see `PromoCodesService` / `AuthService.register`).
 * An admin creates codes for their org; a new user who supplies a valid code
 * at registration joins that org instead of creating a new one.
 */

/** Body for `POST /admin/promo-codes`. */
export const createPromoCodeSchema = z.object({
  maxUses: z.number().int().positive().optional(),
  expiresAt: z.string().datetime().optional(),
  /** Friendly label for the staff list, e.g. "Kaizen, 2-й поток". */
  label: z.string().min(1).max(120).optional(),
});
export type CreatePromoCodeDto = z.infer<typeof createPromoCodeSchema>;

/** A promo code as listed in the admin screen. */
export type PromoCodeDto = {
  id: string;
  code: string;
  active: boolean;
  maxUses: number | null;
  useCount: number;
  expiresAt: string | null;
  label: string | null;
  createdAt: string | null;
};

/**
 * One company + its current active promo code, as listed on the
 * platform-admin "companies" screen (`GET /platform/companies`). Distinct
 * from `PromoCodeDto` above, which is scoped to one org's own admin view —
 * this shape spans every organization, visible only to a platform admin
 * (`AuthUserPayload.isPlatformAdmin`).
 */
export type CompanyCodeDto = {
  organizationId: string;
  organizationName: string;
  code: PromoCodeDto;
};
