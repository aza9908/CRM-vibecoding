import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module';
import { StorageController } from './storage.controller';
import { StorageService } from './storage.service';

/**
 * S3-compatible storage feature module (presigned uploads).
 *
 * Imports `AuthModule` so the controller's `JwtAuthGuard` resolves. Exports
 * `StorageService` in case other modules need to mint URLs server-side.
 */
@Module({
  imports: [AuthModule],
  controllers: [StorageController],
  providers: [StorageService],
  exports: [StorageService],
})
export class StorageModule {}
