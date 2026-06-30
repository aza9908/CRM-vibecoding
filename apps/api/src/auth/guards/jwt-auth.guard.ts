import { Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

import { JWT_USER_STRATEGY } from '../jwt.strategy';

/**
 * Authenticates real-account requests (aud=user). On success populates
 * `request.user` with an `AuthUserPayload`. Pair with `RolesGuard` to enforce
 * role requirements.
 */
@Injectable()
export class JwtAuthGuard extends AuthGuard(JWT_USER_STRATEGY) {}
