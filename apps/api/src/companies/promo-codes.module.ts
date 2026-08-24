import { Module } from '@nestjs/common';

import { PromoCodesService } from './promo-codes.service';

/**
 * Promo-code issuing/redemption, packaged on its own so `AuthModule` can
 * redeem a code at registration without importing the admin controller that
 * creates them (which itself needs the auth guards).
 */
@Module({
  providers: [PromoCodesService],
  exports: [PromoCodesService],
})
export class PromoCodesModule {}
