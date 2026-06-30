import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';
import type { ParticipantPayload } from '@lms/shared';

/**
 * Resolve the authenticated session participant's decoded token payload.
 *
 *   join(@CurrentParticipant() p: ParticipantPayload) { ... }
 *
 * Populated by `ParticipantStrategy`. Only valid behind `ParticipantGuard`.
 */
export const CurrentParticipant = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): ParticipantPayload => {
    const request = ctx.switchToHttp().getRequest<Request>();
    return request.user as ParticipantPayload;
  },
);
