import {
  BadRequestException,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import type {
  AuthUserPayload,
  SessionListItem,
  SessionReport,
} from '@lms/shared';

import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { ReportsService, type ExportRow } from './reports.service';

/**
 * Teacher reporting surface (docs/09 §4–5).
 *
 * Every route requires a teacher User JWT and is scoped to the caller's org
 * inside {@link ReportsService} (the lesson/session is asserted to belong to
 * `user.orgId` before any child rows are read).
 *
 * The routes live at top-level paths (`/lessons/:id/sessions`,
 * `/sessions/:id/report`, `/reports/export`) — no controller prefix — so they
 * sit alongside the existing lessons/sessions surfaces.
 */
@Controller()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('teacher')
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}

  /** GET /lessons/:id/sessions — the lesson's sessions with counters. */
  @Get('lessons/:id/sessions')
  listLessonSessions(
    @CurrentUser() user: AuthUserPayload,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<SessionListItem[]> {
    return this.reports.listLessonSessions(user.orgId, id);
  }

  /** GET /sessions/:id/report — detailed per-session report + metrics. */
  @Get('sessions/:id/report')
  sessionReport(
    @CurrentUser() user: AuthUserPayload,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<SessionReport> {
    return this.reports.sessionReport(user.orgId, id);
  }

  /**
   * GET /reports/export?lessonId=&format=csv|json — aggregate the lesson's
   * sessions on the server and stream a downloadable file. JSON is the
   * hierarchical report; CSV is one row per response. Uses `@Res()` to set the
   * Content-Type + Content-Disposition headers directly (so the body is sent
   * raw, not JSON-wrapped by Nest).
   */
  @Get('reports/export')
  async export(
    @CurrentUser() user: AuthUserPayload,
    @Query('lessonId') lessonId: string,
    @Query('format') format: string | undefined,
    @Res() res: Response,
  ): Promise<void> {
    if (!lessonId) {
      throw new BadRequestException('lessonId_required');
    }
    const fmt = format === 'json' ? 'json' : 'csv';

    const data = await this.reports.aggregateForExport(user.orgId, lessonId);

    if (fmt === 'json') {
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="report-${lessonId}.json"`,
      );
      res.send(JSON.stringify(data, null, 2));
      return;
    }

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="report-${lessonId}.csv"`,
    );
    res.send(this.toCsv(data.rows));
  }

  /**
   * Serialize export rows to CSV. Fixed column order matching docs/09 §5:
   * session_code, participant, block, question, answer, completed, at. Each
   * field is RFC-4180 quoted (doubled inner quotes) so commas / newlines /
   * quotes in answers can't break the layout.
   */
  private toCsv(rows: ExportRow[]): string {
    const header = [
      'session_code',
      'participant',
      'block',
      'question',
      'answer',
      'completed',
      'at',
    ];
    const escape = (value: string | boolean): string => {
      const s = String(value);
      return `"${s.replace(/"/g, '""')}"`;
    };
    const lines = [header.map(escape).join(',')];
    for (const r of rows) {
      lines.push(
        [
          r.session_code,
          r.participant,
          r.block,
          r.question,
          r.answer,
          r.completed,
          r.at,
        ]
          .map(escape)
          .join(','),
      );
    }
    return lines.join('\r\n');
  }
}
