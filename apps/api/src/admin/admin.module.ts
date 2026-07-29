import { Logger, Module, OnModuleInit } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module';
import { UsersModule } from '../users/users.module';
import { WorkbookSeedService } from '../db/workbook-seed.service';
import { AdminController } from './admin.controller';
import { AdminWorkbookController } from './admin-workbook.controller';
import { AdminService } from './admin.service';

/** Admin-only user management module (list users, change roles, reset
 * passwords). `AuthModule` supplies the guards; `UsersModule` the data access. */
@Module({
  imports: [AuthModule, UsersModule],
  controllers: [AdminController, AdminWorkbookController],
  providers: [AdminService, WorkbookSeedService],
})
export class AdminModule implements OnModuleInit {
  private readonly logger = new Logger(AdminModule.name);

  constructor(private readonly seed: WorkbookSeedService) {}

  /** Best-effort schema patch so register(occupation) doesn't 500 on old DBs. */
  async onModuleInit(): Promise<void> {
    try {
      await this.seed.ensureSchema();
    } catch (err) {
      this.logger.warn(
        `ensureSchema failed (will retry on seed): ${(err as Error).message}`,
      );
    }
  }
}
