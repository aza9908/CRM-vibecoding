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
  createdAt: string | null;
};
