import {
  BadRequestException,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import {
  createServerRecordingSchema,
  sendRecordingToYoutubeSchema,
  type AuthUserPayload,
  type CreateServerRecordingDto,
  type SendRecordingToYoutubeDto,
} from '@lms/shared';
import { ZodBody } from '../common/zod-body.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { RecordingsService } from './recordings.service';

/** Call recordings kept on the server until they are on YouTube. Staff only, org-scoped. */
@Controller()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('teacher', 'methodist', 'admin')
export class RecordingsController {
  constructor(private readonly recordings: RecordingsService) {}

  @Post('sessions/:id/recordings')
  create(
    @CurrentUser() user: AuthUserPayload,
    @Param('id', new ParseUUIDPipe()) sessionId: string,
    @ZodBody(createServerRecordingSchema) dto: CreateServerRecordingDto,
  ) {
    return this.recordings.create(user.orgId, user.sub, sessionId, dto);
  }

  /** Raw bytes (application/octet-stream) starting at `offset`. */
  @Put('recordings/:rid/pieces')
  piece(
    @CurrentUser() user: AuthUserPayload,
    @Param('rid', new ParseUUIDPipe()) id: string,
    @Query('offset') offsetRaw: string,
    @Req() req: Request,
  ) {
    const offset = Number(offsetRaw);
    if (!Number.isSafeInteger(offset) || offset < 0) throw new BadRequestException('bad_offset');
    return this.recordings.appendPiece(user.orgId, id, offset, req);
  }

  @Post('recordings/:rid/complete')
  @HttpCode(200)
  complete(@CurrentUser() user: AuthUserPayload, @Param('rid', new ParseUUIDPipe()) id: string) {
    return this.recordings.complete(user.orgId, id);
  }

  @Post('recordings/:rid/youtube')
  @HttpCode(200)
  youtube(
    @CurrentUser() user: AuthUserPayload,
    @Param('rid', new ParseUUIDPipe()) id: string,
    @ZodBody(sendRecordingToYoutubeSchema) dto: SendRecordingToYoutubeDto,
  ) {
    return this.recordings.sendToYoutube(user.orgId, id, dto.accessToken);
  }

  @Get('recordings/pending')
  pending(@CurrentUser() user: AuthUserPayload) {
    return this.recordings.pending(user.orgId);
  }

  @Get('recordings/:rid')
  get(@CurrentUser() user: AuthUserPayload, @Param('rid', new ParseUUIDPipe()) id: string) {
    return this.recordings.get(user.orgId, id);
  }

  @Delete('recordings/:rid')
  @HttpCode(204)
  async remove(@CurrentUser() user: AuthUserPayload, @Param('rid', new ParseUUIDPipe()) id: string) {
    await this.recordings.remove(user.orgId, id);
  }
}
