import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

/** Lifetime (seconds) of a generated presigned upload URL. */
const PRESIGN_TTL_SECONDS = 60;

/**
 * S3-compatible object storage (MinIO locally, Cloudflare R2 in prod).
 *
 * The backend never proxies file bytes: it hands the client a short-lived
 * presigned `PUT` URL, the client uploads straight to the bucket, then stores
 * the returned `publicUrl` on the block. `forcePathStyle` is required for MinIO
 * and works with R2's path-style endpoint too.
 *
 * Secrets (`S3_ACCESS_KEY` / `S3_SECRET_KEY`) live only here on the backend.
 */
@Injectable()
export class StorageService implements OnModuleInit {
  private readonly logger = new Logger(StorageService.name);
  private client?: S3Client;
  private endpoint!: string;
  private bucket!: string;

  constructor(private readonly config: ConfigService) {}

  onModuleInit(): void {
    const endpoint = this.config.get<string>('S3_ENDPOINT');
    const bucket = this.config.get<string>('S3_BUCKET');
    const accessKeyId = this.config.get<string>('S3_ACCESS_KEY');
    const secretAccessKey = this.config.get<string>('S3_SECRET_KEY');
    const region = this.config.get<string>('S3_REGION') ?? 'auto';

    if (!endpoint || !bucket || !accessKeyId || !secretAccessKey) {
      this.logger.warn(
        'Storage not configured (S3_ENDPOINT, S3_BUCKET, S3_ACCESS_KEY, S3_SECRET_KEY missing). ' +
          'The API will start, but file upload endpoints will fail until these are set.',
      );
      return;
    }

    this.endpoint = endpoint.replace(/\/+$/, '');
    this.bucket = bucket;
    this.client = new S3Client({
      endpoint: this.endpoint,
      region,
      forcePathStyle: true,
      credentials: { accessKeyId, secretAccessKey },
    });
  }

  /** Returns the configured client or throws a clear error on first use. */
  private requireClient(): S3Client {
    if (!this.client) {
      throw new Error(
        'Storage misconfigured: S3_ENDPOINT, S3_BUCKET, S3_ACCESS_KEY and S3_SECRET_KEY are required',
      );
    }
    return this.client;
  }

  /** Presigned `PUT` URL (valid ~60s) for uploading `key` with `contentType`. */
  async getSignedPutUrl(key: string, contentType: string): Promise<string> {
    const command = new PutObjectCommand({
      Bucket: this.bucket,
      Key: key,
      ContentType: contentType,
    });
    return getSignedUrl(this.requireClient(), command, {
      expiresIn: PRESIGN_TTL_SECONDS,
    });
  }

  /**
   * Presigned `GET` URL for downloading a private object (default 5 min).
   * Used for `course-materials/` files which live in a private bucket and must
   * never be served via a stable public URL.
   */
  async getSignedGetUrl(key: string, ttlSeconds = 300): Promise<string> {
    const command = new GetObjectCommand({
      Bucket: this.bucket,
      Key: key,
    });
    return getSignedUrl(this.requireClient(), command, { expiresIn: ttlSeconds });
  }

  /** Hard-delete an object (e.g. when a material file is removed). */
  async deleteObject(key: string): Promise<void> {
    await this.requireClient().send(
      new DeleteObjectCommand({ Bucket: this.bucket, Key: key }),
    );
  }

  /** Stable, path-style public URL for an object once uploaded. */
  publicUrl(key: string): string {
    return `${this.endpoint}/${this.bucket}/${encodeURI(key)}`;
  }
}
