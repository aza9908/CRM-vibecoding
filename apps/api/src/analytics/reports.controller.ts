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
import {
  ReportsService,
  type ExportRow,
  type ParticipantExportRow,
} from './reports.service';

/**
 * Teacher reporting surface (docs/09 §4–5).
 *
 * Every route requires a teacher User JWT and is scoped to the caller's org
 * inside {@link ReportsService}.
 */
@Controller()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('teacher', 'methodist', 'admin')
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
   * GET /reports/export?lessonId=&sessionId=&format=csv|json|xlsx
   */
  @Get('reports/export')
  async export(
    @CurrentUser() user: AuthUserPayload,
    @Query('lessonId') lessonId: string,
    @Query('sessionId') sessionId: string | undefined,
    @Query('format') format: string | undefined,
    @Res() res: Response,
  ): Promise<void> {
    if (!lessonId) {
      throw new BadRequestException('lessonId_required');
    }
    const fmt =
      format === 'json' ? 'json' : format === 'xlsx' ? 'xlsx' : 'csv';

    const data = await this.reports.aggregateForExport(
      user.orgId,
      lessonId,
      sessionId || null,
    );

    const fileBase = sessionId
      ? `session-${sessionId.slice(0, 8)}`
      : `report-${lessonId.slice(0, 8)}`;

    if (fmt === 'json') {
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="${fileBase}.json"`,
      );
      res.send(JSON.stringify(data, null, 2));
      return;
    }

    if (fmt === 'xlsx') {
      res.setHeader('Content-Type', 'application/vnd.ms-excel; charset=utf-8');
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="${fileBase}.xls"`,
      );
      res.send(this.toSpreadsheetMl(data.participants, data.rows));
      return;
    }

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${fileBase}.csv"`,
    );
    // BOM so Excel opens Russian headers correctly.
    res.send('\uFEFF' + this.toCsv(data.rows));
  }

  private toCsv(rows: ExportRow[]): string {
    const header = [
      'Код сессии',
      'ФИО',
      'Должность',
      'Компания',
      'Прогресс %',
      'Тип блока',
      'Вопрос',
      'Ответ',
      'Выполнено',
      'Время',
    ];
    const escape = (value: string | boolean | number): string => {
      const s = String(value);
      return `"${s.replace(/"/g, '""')}"`;
    };
    const lines = [header.map(escape).join(',')];
    for (const r of rows) {
      lines.push(
        [
          r.session_code,
          r.full_name,
          r.occupation,
          r.company,
          r.progress_percent,
          r.block,
          r.question,
          r.answer,
          r.completed ? 'да' : 'нет',
          r.at,
        ]
          .map(escape)
          .join(','),
      );
    }
    return lines.join('\r\n');
  }

  /**
   * SpreadsheetML with two sheets:
   * 1) Участники — one row per person (ФИО, должность, компания, прогресс)
   * 2) Ответы — answers grouped by name
   */
  private toSpreadsheetMl(
    participants: ParticipantExportRow[],
    rows: ExportRow[],
  ): string {
    const escapeXml = (value: string | boolean | number): string =>
      String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');

    const cell = (v: string | boolean | number) =>
      `<Cell><Data ss:Type="${typeof v === 'number' ? 'Number' : 'String'}">${escapeXml(v)}</Data></Cell>`;
    const rowXml = (cols: Array<string | boolean | number>) =>
      `<Row>${cols.map(cell).join('')}</Row>`;

    const participantsBody = [
      rowXml([
        'Код сессии',
        'ФИО',
        'Должность',
        'Компания',
        'Прогресс %',
        'Отвечено',
        'Всего заданий',
      ]),
      ...participants.map((p) =>
        rowXml([
          p.session_code,
          p.full_name,
          p.occupation,
          p.company,
          p.progress_percent,
          p.answered,
          p.total_interactive,
        ]),
      ),
    ].join('');

    const answersBody = [
      rowXml([
        'Код сессии',
        'ФИО',
        'Должность',
        'Компания',
        'Прогресс %',
        'Тип блока',
        'Вопрос',
        'Ответ',
        'Выполнено',
        'Время',
      ]),
      ...rows.map((r) =>
        rowXml([
          r.session_code,
          r.full_name,
          r.occupation,
          r.company,
          r.progress_percent,
          r.block,
          r.question,
          r.answer,
          r.completed ? 'да' : 'нет',
          r.at,
        ]),
      ),
    ].join('');

    return `<?xml version="1.0"?>
<?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"
 xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">
 <Worksheet ss:Name="Участники"><Table>${participantsBody}</Table></Worksheet>
 <Worksheet ss:Name="Ответы"><Table>${answersBody}</Table></Worksheet>
</Workbook>`;
  }
}
