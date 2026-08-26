import { Module } from '@nestjs/common';

import { PromoCodesService } from './promo-codes.service';

/**
 * `PromoCodesService` only — no controller here, and deliberately no
 * `AuthModule` import (the service only needs the global `DRIZZLE` token).
 * This keeps the module a DI leaf so both `AuthModule` (register() joins an
 * org via a code) and `AdminModule` (hosts `PromoCodesController`, the
 * admin CRUD surface) can import it without a circular module graph.
 */
@Module({
  providers: [PromoCodesService],
  exports: [PromoCodesService],
})
export class PromoCodesModule {}
