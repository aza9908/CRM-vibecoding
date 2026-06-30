import { Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

import { JWT_PARTICIPANT_STRATEGY } from '../participant.strategy';

/**
 * Authenticates session-guest requests (aud=participant). On success populates
 * `request.user` with a `ParticipantPayload`. Grants access only to the session
 * the token was issued for — never to user endpoints.
 */
@Injectable()
export class ParticipantGuard extends AuthGuard(JWT_PARTICIPANT_STRATEGY) {}
