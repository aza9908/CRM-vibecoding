import { Controller, Get, Param, ParseUUIDPipe, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { createReadStream } from 'node:fs';
import { RecordingsService } from './recordings.service';

/**
 * Download of a lesson recording kept on the server. Opened by the browser
 * directly (a big file must not go through script memory), so it carries a
 * signed, 15-minute link from `POST /recordings/:rid/download-link` instead of
 * a login header.
 */
@Controller()
export class RecordingDownloadController {
  constructor(private readonly recordings: RecordingsService) {}

  @Get('recordings/:rid/file')
  async file(
    @Param('rid', new ParseUUIDPipe()) id: string,
    @Query('exp') exp: string,
    @Query('sig') sig: string,
    @Res() res: Response,
  ): Promise<void> {
    const f = await this.recordings.openDownload(id, Number(exp), String(sig ?? ''));
    res.setHeader('content-type', f.mimeType);
    res.setHeader('content-length', String(f.size));
    res.setHeader('cache-control', 'private, no-store');
    res.setHeader(
      'content-disposition',
      `attachment; filename="lesson.${f.fileName.split('.').pop()}"; filename*=UTF-8''${encodeURIComponent(f.fileName)}`,
    );
    createReadStream(f.path).pipe(res);
  }
}
