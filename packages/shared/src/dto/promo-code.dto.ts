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

/**
 * Body for `POST /platform/companies` — adds a company to the catalog
 * (TZ_LMS_roles_promocodes.md §4.1/§7.3). A company is metadata only; it
 * never gets a login of its own. A promo code is auto-issued for it in the
 * same request, same as the day-one code every company already gets.
 */
export const createCompanySchema = z.object({
  name: z.string().min(1).max(200),
  contactName: z.string().min(1).max(200).optional(),
  contactEmail: z.string().email().optional(),
  contactPhone: z.string().min(1).max(40).optional(),
  notes: z.string().max(2000).optional(),
});
export type CreateCompanyDto = z.infer<typeof createCompanySchema>;
