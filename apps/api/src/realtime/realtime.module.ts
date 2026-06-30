import { forwardRef, Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { ResponsesModule } from '../responses/responses.module';
import { SessionsModule } from '../sessions/sessions.module';
import { SessionGateway } from './session.gateway';

/**
 * Realtime layer: the Socket.IO `/live` gateway.
 *
 *  - AuthModule provides AuthService (verifying handshake tokens, both audiences).
 *  - SessionsModule (forwardRef — mutual reference with SessionsModule)
 *    provides SessionsService for focus persistence / participant lookup.
 *  - ResponsesModule provides ResponsesService for the `response:save` upsert.
 *
 * Exports SessionGateway so the sessions controller can broadcast
 * `session:ended` when a session is ended over REST.
 */
@Module({
  imports: [
    AuthModule,
    ResponsesModule,
    forwardRef(() => SessionsModule),
  ],
  providers: [SessionGateway],
  exports: [SessionGateway],
})
export class RealtimeModule {}
