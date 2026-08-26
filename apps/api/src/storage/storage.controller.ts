import { randomUUID } from 'node:crypto';
import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Header,
  Post,
  Put,
  Query,
  Req,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { memoryStorage } from 'multer';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Request, Response } from 'express';
import { presignSchema, type PresignDto } from '@lms/shared';

import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { StorageService } from './storage.service';

/** Result of `POST /uploads/presign`. */
type PresignResult = { uploadUrl: string; publicUrl: string; mode: string };

type UploadResult = { key: string; publicUrl: string; mode: string };

/**
 * Upload endpoints.
 *
 * Preferred path for workshop deploys without S3 secrets:
 *   `POST /uploads` (JWT + multipart) → persists via S3 or Postgres fallback.
 *
 * Legacy path (still used when S3 is configured):
 *   `POST /uploads/presign` → client PUTs to the returned URL.
 */
@Controller('uploads')
export class StorageController {
  constructor(private readonly storage: StorageService) {}

  /**
   * POST /uploads — multipart upload (`file` + optional `scope`).
   * Works in both S3 and DB storage modes; preferred for materials (PPTX).
   */
  @Post()
  @UseGuards(JwtAuthGuard)
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: 40 * 1024 * 1024 },
    }),
  )
  async upload(
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body('scope') scope: string | undefined,
    @Req() req: Request,
  ): Promise<UploadResult> {
    if (!file?.buffer?.length) {
      throw new BadRequestException('file_required');
    }
    const safeName = (file.originalname || 'upload.bin').replace(
      /[^\w.\-]+/g,
      '_',
    );
    const prefix =
      scope === 'course-materials' ? 'course-materials' : 'lesson-media';
    const key = `${prefix}/${randomUUID()}-${safeName}`;
    await this.storage.putObject(
      key,
      file.buffer,
      file.mimetype || 'application/octet-stream',
    );
    const requestOrigin = this.requestApiOrigin(req);
    return {
      key,
      publicUrl: this.storage.publicUrl(key, { requestOrigin }),
      mode: this.storage.getMode(),
    };
  }

  /** POST /uploads/presign — issue a short-lived PUT URL. */
  @Post('presign')
  @UseGuards(JwtAuthGuard)
  async presign(
    @Body(new ZodValidationPipe(presignSchema)) dto: PresignDto,
    @Req() req: Request,
  ): Promise<PresignResult> {
    const safeName = dto.filename.replace(/[^\w.\-]+/g, '_');
    const prefix =
      dto.scope === 'course-materials' ? 'course-materials' : 'lesson-media';
    const key = `${prefix}/${randomUUID()}-${safeName}`;
    const requestOrigin = this.requestApiOrigin(req);
    const uploadUrl = await this.storage.getSignedPutUrl(key, dto.contentType, {
      requestOrigin,
    });
    return {
      uploadUrl,
      publicUrl: this.storage.publicUrl(key, { requestOrigin }),
      mode: this.storage.getMode(),
    };
  }

  /**
   * PUT /uploads/direct?key=&exp=&sig= — DB-mode upload target (HMAC query).
   */
  @Put('direct')
  async putDirect(
    @Query('key') key: string,
    @Query('exp') expRaw: string,
    @Query('sig') sig: string,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    if (!key || !expRaw || !sig) {
      res.status(400).json({ message: 'missing_upload_params' });
      return;
    }
    const maxBytes = 40 * 1024 * 1024;
    const chunks: Buffer[] = [];
    let total = 0;
    for await (const chunk of req) {
      const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      total += buf.byteLength;
      if (total > maxBytes) {
        res.status(400).json({ message: 'file_too_large' });
        req.destroy();
        return;
      }
      chunks.push(buf);
    }
    const data = Buffer.concat(chunks);
    const contentType =
      (typeof req.headers['content-type'] === 'string'
        ? req.headers['content-type']
        : '') || 'application/octet-stream';
    await this.storage.putDirectObject(
      key,
      contentType,
      data,
      Number(expRaw),
      sig,
    );
    res.status(200).json({ ok: true, key, byteSize: data.byteLength });
  }

  /** GET /uploads/file?key=&exp=&sig= — DB-mode download. */
  @Get('file')
  @Header('Cache-Control', 'private, max-age=60')
  async getFile(
    @Query('key') key: string,
    @Query('exp') expRaw: string,
    @Query('sig') sig: string,
    @Res() res: Response,
  ): Promise<void> {
    if (!key || !expRaw || !sig) {
      res.status(400).json({ message: 'missing_download_params' });
      return;
    }
    const { contentType, data } = await this.storage.getDirectObject(
      key,
      Number(expRaw),
      sig,
    );
    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Length', String(data.byteLength));
    res.send(data);
  }

  private requestApiOrigin(req: Request): string {
    const proto = String(req.headers['x-forwarded-proto'] ?? req.protocol);
    const host = String(
      req.headers['x-forwarded-host'] ?? req.headers.host ?? '',
    );
    if (!host) return '';
    return `${proto}://${host}`;
  }
}
