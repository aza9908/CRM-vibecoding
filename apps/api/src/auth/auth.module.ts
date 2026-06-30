import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';

import { UsersModule } from '../users/users.module';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtStrategy } from './jwt.strategy';
import { ParticipantStrategy } from './participant.strategy';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { ParticipantGuard } from './guards/participant.guard';
import { RolesGuard } from './guards/roles.guard';
import { WsRolesGuard } from './guards/ws-roles.guard';

/**
 * Owns authentication for both audiences (user + participant).
 *
 * `JwtModule` is registered with the access secret as the default signing key;
 * the service overrides the secret/TTL per token type explicitly. Strategies,
 * guards, and `AuthService` are exported so other modules (sessions, realtime,
 * lessons) can authenticate and authorize requests.
 */
@Module({
  imports: [
    PassportModule,
    UsersModule,
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const secret = config.get<string>('JWT_ACCESS_SECRET');
        if (!secret) {
          throw new Error('JWT_ACCESS_SECRET is not set');
        }
        return {
          secret,
          signOptions: { expiresIn: '15m' },
        };
      },
    }),
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    JwtStrategy,
    ParticipantStrategy,
    JwtAuthGuard,
    ParticipantGuard,
    RolesGuard,
    WsRolesGuard,
  ],
  exports: [
    AuthService,
    JwtAuthGuard,
    ParticipantGuard,
    RolesGuard,
    WsRolesGuard,
  ],
})
export class AuthModule {}
