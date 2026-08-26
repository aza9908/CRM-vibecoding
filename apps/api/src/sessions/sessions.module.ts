import { forwardRef, Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { ResponsesModule } from '../responses/responses.module';
import { RealtimeModule } from '../realtime/realtime.module';
import { ProgressModule } from '../progress/progress.module';
import { StorageModule } from '../storage/storage.module';
import { UserOrParticipantGuard } from '../auth/guards/user-or-participant.guard';
import { SessionsController } from './sessions.controller';
import { SessionsService } from './sessions.service';
import { SessionChatService } from './session-chat.service';

/**
 * Live-session REST + domain logic.
 *
 *  - AuthModule provides AuthService (issuing participant tokens on join).
 *  - ResponsesModule provides the answer summary for `GET /sessions/:id/responses`.
 *  - RealtimeModule (forwardRef — they reference each other) provides the
 *    SessionGateway so `POST /sessions/:id/end` can broadcast `session:ended`.
 *  - ProgressModule provides ActivityService so the join flow can record a
 *    `session_join` analytics event for authenticated participants.
 *  - StorageModule provides StorageService for the `input_file` block's
 *    upload/download endpoints.
 *
 * Exports SessionsService for the gateway and other modules.
 */
@Module({
  imports: [
    AuthModule,
    ResponsesModule,
    forwardRef(() => RealtimeModule),
    ProgressModule,
    StorageModule,
  ],
  controllers: [SessionsController],
  providers: [SessionsService, SessionChatService, UserOrParticipantGuard],
  exports: [SessionsService, SessionChatService],
})
export class SessionsModule {}
