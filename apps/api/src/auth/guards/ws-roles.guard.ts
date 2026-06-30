import {
  CanActivate,
  ExecutionContext,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { WsException } from '@nestjs/websockets';
import type { Socket } from 'socket.io';
import type {
  AuthUserPayload,
  ParticipantPayload,
  UserRole,
} from '@lms/shared';

import { ROLES_KEY } from '../decorators/roles.decorator';

/** Payload attached to an authenticated socket by the realtime gateway. */
type SocketAuthPayload = AuthUserPayload | ParticipantPayload;

/**
 * The realtime gateway attaches the verified token payload to the socket under
 * `socket.data.identity` after a successful `verifySocketToken` call.
 */
interface AuthedSocket extends Socket {
  data: Socket['data'] & { identity?: SocketAuthPayload };
}

function isUserPayload(p: SocketAuthPayload): p is AuthUserPayload {
  return p.aud !== 'participant';
}

/**
 * Role-checks a WebSocket message handler against `@Roles(...)`.
 *
 * Expects the gateway to have authenticated the socket and stored the decoded
 * payload at `socket.data.identity`. A participant token never satisfies a role
 * requirement (participants have no role), so `@Roles('teacher')` on a WS
 * handler effectively also enforces aud=user.
 */
@Injectable()
export class WsRolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<UserRole[] | undefined>(
      ROLES_KEY,
      [context.getHandler(), context.getClass()],
    );

    const socket = context.switchToWs().getClient<AuthedSocket>();
    const payload = socket.data?.identity;
    if (!payload) {
      throw new WsException('unauthorized');
    }

    if (!required || required.length === 0) {
      return true;
    }

    if (!isUserPayload(payload) || !required.includes(payload.role)) {
      throw new WsException('insufficient_role');
    }
    return true;
  }
}
