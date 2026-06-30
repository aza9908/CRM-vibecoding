import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module';
import { UserOrParticipantGuard } from '../auth/guards/user-or-participant.guard';
import { LessonsModule } from '../lessons/lessons.module';
import { SessionsModule } from '../sessions/sessions.module';
import { StorageModule } from '../storage/storage.module';
import { MaterialsController } from './materials.controller';
import { MaterialsService } from './materials.service';

/**
 * Materials feature module (docs/07).
 *
 *  - AuthModule       — guards (JwtAuthGuard, RolesGuard) + AuthService for the
 *                       UserOrParticipantGuard's token verification.
 *  - LessonsModule    — LessonsService.assertLessonInOrg for lesson access checks.
 *  - SessionsModule   — SessionsService.get to resolve a participant's session.
 *  - StorageModule    — StorageService for presigned GET / object deletion.
 *
 * UserOrParticipantGuard is registered as a provider so it can be DI-resolved on
 * the two routes reachable by both users and session participants.
 */
@Module({
  imports: [AuthModule, LessonsModule, SessionsModule, StorageModule],
  controllers: [MaterialsController],
  providers: [MaterialsService, UserOrParticipantGuard],
  exports: [MaterialsService],
})
export class MaterialsModule {}
