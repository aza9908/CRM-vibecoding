import { Module } from '@nestjs/common';

import { UsersService } from './users.service';

/**
 * Encapsulates access to the `users` table. The DbModule is `@Global()`, so the
 * DRIZZLE token is available without importing it here.
 */
@Module({
  providers: [UsersService],
  exports: [UsersService],
})
export class UsersModule {}
