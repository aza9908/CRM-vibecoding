import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module';
import { UsersModule } from '../users/users.module';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';

/** Admin-only user management module (list users, change roles, reset
 * passwords). `AuthModule` supplies the guards; `UsersModule` the data access. */
@Module({
  imports: [AuthModule, UsersModule],
  controllers: [AdminController],
  providers: [AdminService],
})
export class AdminModule {}
