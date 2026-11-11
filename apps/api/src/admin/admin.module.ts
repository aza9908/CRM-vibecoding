import { Logger, Module, OnModuleInit } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module';
import { UsersModule } from '../users/users.module';
import { PromoCodesModule } from '../promo-codes/promo-codes.module';
import { WorkbookSeedService } from '../db/workbook-seed.service';
import { AdminController } from './admin.controller';
import { AdminWorkbookController } from './admin-workbook.controller';
import { PromoCodesController } from '../promo-codes/promo-codes.controller';
import { PlatformController } from '../promo-codes/platform.controller';
import { AdminService } from './admin.service';

/** Admin-only user management module (list users, change roles, reset
 * passwords, promo codes). `AuthModule` supplies the guards; `UsersModule`
 * and `PromoCodesModule` the data access. `PlatformController` lives here too
 * (not its own module) since it only needs the same two dependencies. */
@Module({
  imports: [AuthModule, UsersModule, PromoCodesModule],
  controllers: [
    AdminController,
    AdminWorkbookController,
    PromoCodesController,
    PlatformController,
  ],
  providers: [AdminService, WorkbookSeedService],
})
export class AdminModule implements OnModuleInit {
  private readonly logger = new Logger(AdminModule.name);

  constructor(private readonly seed: WorkbookSeedService) {}

  /**
   * On boot: ensure `users.occupation` exists, then create the Day-1 workshop
   * lesson in every organization that lacks it, so every teacher sees it
   * under Уроки. Existing lessons (and teachers' edits) are left untouched.
   */
  async onModuleInit(): Promise<void> {
    try {
      await this.seed.ensureSchema();
    } catch (err) {
      this.logger.warn(
        `ensureSchema failed (will retry on seed): ${(err as Error).message}`,
      );
    }
    try {
      // Boot only creates missing workshop lessons; it never overwrites
      // blocks a teacher edited (POST /admin/workbook/seed* refreshes them).
      const { orgs, results } = await this.seed.seedAllOrgs({ onlyIfEmpty: true });
      this.logger.log(
        `Day-1 workbook ready in ${results.length}/${orgs} organizations`,
      );
    } catch (err) {
      this.logger.warn(
        `seedAllOrgs failed (call POST /admin/workbook/seed): ${(err as Error).message}`,
      );
    }
    try {
      const orzu = await this.seed.seedOrzuOrgs({ onlyIfEmpty: true });
      this.logger.log(`Orzu Medical week-1 lesson ready in ${orzu.length} organization(s)`);
    } catch (err) {
      this.logger.warn(
        `seedOrzuOrgs failed (call POST /admin/workbook/seed-orzu): ${(err as Error).message}`,
      );
    }
  }
}
