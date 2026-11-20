import { Controller, Get, Param, ParseUUIDPipe, Post, Query, UseGuards } from '@nestjs/common';
import {
  curatorReportQuerySchema,
  startAnswersAnalysisSchema,
  startCuratorReportSchema,
  type AuthUserPayload,
  type CuratorReportQuery,
  type StartAnswersAnalysisDto,
  type StartCuratorReportDto,
} from '@lms/shared';
import { ZodBody } from '../common/zod-body.decorator';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { AiReportsService } from './ai-reports.service';

/**
 * «ИИ-анализ ответов» and «ИИ-куратор» — REST surface.
 *
 * Staff only (`aud=user` JWT + role); a participant token never gets here.
 * Every call is scoped to the caller's organisation inside AiReportsService:
 * a session of another organisation answers 403/404 like the neighbouring
 * endpoints, a company (lesson category) of another organisation is 404.
 */
@Controller()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('teacher', 'methodist', 'admin')
export class AiReportsController {
  constructor(private readonly reports: AiReportsService) {}

  /** POST /sessions/:id/answers-analysis — start (or return the running one). */
  @Post('sessions/:id/answers-analysis')
  startAnswers(
    @CurrentUser() user: AuthUserPayload,
    @Param('id', new ParseUUIDPipe()) id: string,
    @ZodBody(startAnswersAnalysisSchema) dto: StartAnswersAnalysisDto,
  ) {
    return this.reports.startAnswers(user.orgId, user.sub, id, dto.locale);
  }

  /** GET /sessions/:id/answers-analysis — `{ analysis }`, the latest or null. */
  @Get('sessions/:id/answers-analysis')
  async latestAnswers(
    @CurrentUser() user: AuthUserPayload,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    return { analysis: await this.reports.latestAnswers(user.orgId, id) };
  }

  /** POST /curator/reports — `{ category }`: start the company's report. */
  @Post('curator/reports')
  startCurator(
    @CurrentUser() user: AuthUserPayload,
    @ZodBody(startCuratorReportSchema) dto: StartCuratorReportDto,
  ) {
    return this.reports.startCurator(user.orgId, user.sub, dto.category, dto.locale);
  }

  /** GET /curator/reports?category= — company tiles + that company's latest report. */
  @Get('curator/reports')
  curator(
    @CurrentUser() user: AuthUserPayload,
    @Query(new ZodValidationPipe(curatorReportQuerySchema)) query: CuratorReportQuery,
  ) {
    return this.reports.curatorOverview(user.orgId, query.category);
  }
}
