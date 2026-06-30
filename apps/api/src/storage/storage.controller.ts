import { randomUUID } from 'node:crypto';
import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { presignSchema, type PresignDto } from '@lms/shared';

import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { StorageService } from './storage.service';

/** Result of `POST /uploads/presign`. */
type PresignResult = { uploadUrl: string; publicUrl: string };

/**
 * Upload presign endpoint (docs/03 §4).
 *
 * Any authenticated user may request a presigned URL — the key is randomised
 * server-side so callers cannot overwrite arbitrary objects. The client then
 * `PUT`s the file straight to S3/R2/MinIO and persists `publicUrl` on the block.
 */
@Controller('uploads')
@UseGuards(JwtAuthGuard)
export class StorageController {
  constructor(private readonly storage: StorageService) {}

  /** POST /uploads/presign — issue a short-lived presigned PUT URL. */
  @Post('presign')
  async presign(
    @Body(new ZodValidationPipe(presignSchema)) dto: PresignDto,
  ): Promise<PresignResult> {
    const safeName = dto.filename.replace(/[^\w.\-]+/g, '_');
    const prefix =
      dto.scope === 'course-materials' ? 'course-materials' : 'lesson-media';
    const key = `${prefix}/${randomUUID()}-${safeName}`;
    const uploadUrl = await this.storage.getSignedPutUrl(key, dto.contentType);
    return { uploadUrl, publicUrl: this.storage.publicUrl(key) };
  }
}
