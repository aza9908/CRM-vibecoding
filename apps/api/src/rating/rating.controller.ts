import {
  Controller,
  NotFoundException,
  Get,
  Param,
  ParseUUIDPipe,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import {
  studentRatingQuerySchema,
  type AuthUserPayload,
  type MyStudentRatingResponse,
  type ParticipantPayload,
  type SessionStudentRatingResponse,
  type StudentRatingQuery,
  type StudentRatingResponse,
} from '@lms/shared';

import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { UserOrParticipantGuard } from '../auth/guards/user-or-participant.guard';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { RatingService } from './rating.service';

/**
 * Student rating («Рейтинг»): points for workbook work in live lessons.
 *
 *  - `GET /rating`              staff table of the caller's organization;
 *  - `GET /rating/me`           a student account's own standing + top 10;
 *  - `GET /sessions/:id/rating` the live lesson's company top 10, for the
 *                               session's participants and its org's users.
 *
 * Payloads carry names and numbers only — never phones or emails.
 */
@Controller()
export class RatingController {
  constructor(private readonly rating: RatingService) {}

  @Get('rating')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('teacher', 'methodist', 'admin')
  list(
    @CurrentUser() user: AuthUserPayload,
    @Query(new ZodValidationPipe(studentRatingQuerySchema)) query: StudentRatingQuery,
  ): Promise<StudentRatingResponse> {
    return this.rating.forStaff(user.orgId, query.category, query.period);
  }

  @Get('rating/me')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('student')
  me(@CurrentUser() user: AuthUserPayload): Promise<MyStudentRatingResponse> {
    return this.rating.forStudent(user.orgId, user.sub);
  }

  /**
   * A participant token works only for the session it was issued for; a user
   * token only for sessions of the user's organization. Both refusals are 404.
   */
  @Get('sessions/:id/rating')
  @UseGuards(UserOrParticipantGuard)
  sessionRating(
    @Req() req: Request,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<SessionStudentRatingResponse> {
    const principal = req.user as AuthUserPayload | ParticipantPayload;
    if (principal.aud === 'participant') {
      if (principal.sessionId !== id) {
        return Promise.reject(new NotFoundException('session_not_found'));
      }
      return this.rating.forSession(id, { orgId: null, participantId: principal.sub });
    }
    return this.rating.forSession(id, { orgId: principal.orgId, userId: principal.sub });
  }
}
