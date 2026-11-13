import {
  BadRequestException,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import {
  ANALYSIS_AUDIO_PIECE_MAX_BYTES,
  finishAnalysisSchema,
  uploadAnalysisAudioSchema,
  type AuthUserPayload,
  type FinishAnalysisDto,
  type UploadAnalysisAudioDto,
} from '@lms/shared';
import { ZodBody } from '../common/zod-body.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { AnalysisService } from './analysis.service';

/**
 * «ИИ-разбор урока» — REST surface.
 *
 * Staff only (`aud=user` JWT + role), and every call is scoped to the
 * caller's organisation inside AnalysisService: a session or lesson of
 * another organisation answers 403/404 like the neighbouring endpoints, and a
 * participant token never gets here (JwtAuthGuard accepts user tokens only).
 */
@Controller()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('teacher', 'methodist', 'admin')
export class AnalysisController {
  constructor(private readonly analysis: AnalysisService) {}

  /**
   * POST /sessions/:id/analysis/audio — one piece of the recording's audio
   * (multipart: `file` + `recordingId` + `seq`). Sent in order while the
   * lesson is being recorded, so no single request is large.
   */
  @Post('sessions/:id/analysis/audio')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: ANALYSIS_AUDIO_PIECE_MAX_BYTES },
    }),
  )
  uploadAudio(
    @CurrentUser() user: AuthUserPayload,
    @Param('id', new ParseUUIDPipe()) id: string,
    @UploadedFile() file: Express.Multer.File | undefined,
    @ZodBody(uploadAnalysisAudioSchema) body: UploadAnalysisAudioDto,
  ) {
    if (!file?.buffer?.length) throw new BadRequestException('file_required');
    return this.analysis.appendAudio(user.orgId, id, body.recordingId, body.seq, file.buffer);
  }

  /** POST /sessions/:id/analysis/finish — recording stopped: start the analysis. */
  @Post('sessions/:id/analysis/finish')
  finish(
    @CurrentUser() user: AuthUserPayload,
    @Param('id', new ParseUUIDPipe()) id: string,
    @ZodBody(finishAnalysisSchema) dto: FinishAnalysisDto,
  ) {
    return this.analysis.finish(user.orgId, id, dto);
  }

  /** GET /sessions/:id/analysis — the session's latest analysis, or null. */
  @Get('sessions/:id/analysis')
  async latest(
    @CurrentUser() user: AuthUserPayload,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    // `{ analysis: null }` rather than a bare null keeps the body valid JSON.
    return { analysis: await this.analysis.latestForSession(user.orgId, id) };
  }

  /** GET /lessons/:id/analyses — every analysis of a lesson, newest first. */
  @Get('lessons/:id/analyses')
  list(
    @CurrentUser() user: AuthUserPayload,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    return this.analysis.listForLesson(user.orgId, id);
  }
}
