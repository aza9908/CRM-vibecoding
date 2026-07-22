import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module';
import { ProgramController } from './program.controller';
import { ProgramService } from './program.service';

/**
 * Program-of-study management module. `AuthModule` is imported so the
 * controller's guards (`JwtAuthGuard`, `RolesGuard`) resolve; `DRIZZLE` comes
 * from the global `DbModule`.
 */
@Module({
  imports: [AuthModule],
  controllers: [ProgramController],
  providers: [ProgramService],
})
export class ProgramModule {}
