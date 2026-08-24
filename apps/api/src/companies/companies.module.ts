import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module';
import { CompaniesController } from './companies.controller';
import { CompaniesService } from './companies.service';
import { PromoCodesModule } from './promo-codes.module';

/** Admin-facing company + promo-code management, scoped to the caller's org. */
@Module({
  imports: [AuthModule, PromoCodesModule],
  controllers: [CompaniesController],
  providers: [CompaniesService],
})
export class CompaniesModule {}
