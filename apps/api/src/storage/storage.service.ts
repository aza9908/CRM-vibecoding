import {
  createHmac,
  timingSafeEqual,
} from 'node:crypto';
import {
  BadGatewayException,
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { Inject } from '@nestjs/common';
import type { Pool } from 'pg';

import { PG_POOL } from '../db/db.module';

/** Lifetime (seconds) of a generated presigned upload URL. */
const PRESIGN_TTL_SECONDS = 60;
/** Lifetime for download / direct-upload HMAC tokens when using DB storage. */
const DB_URL_TTL_SECONDS = 300;
/**
 * Lifetime for `publicUrl()`'s DB-mode signed URL. This one is baked directly
 * into `lesson_blocks.image_url` at authoring time and expected to keep
 * working indefinitely (the method is documented as "stable"), unlike the
 * short-lived download/upload tokens above — so it needs a TTL long enough
 * that lesson images don't silently 404 months (or even a week) later.
 */
const PUBLIC_URL_TTL_SECONDS = 10 * 365 * 24 * 3600;
/** Cap for DB-backed uploads (workshop decks / materials); also reused by
 * callers (e.g. `SessionsController`'s multipart limits) as the single
 * upload-size ceiling shared across the app. */
export const MAX_DB_OBJECT_BYTES = 40 * 1024 * 1024;

type StorageMode = 's3' | 'db';

/**
 * Object storage for lesson media + course materials.
 *
 * Prefer S3-compatible (MinIO locally, R2 in prod). When `S3_*` env vars are
 * missing — common on App Hosting until secrets are wired — fall back to a
 * Postgres `stored_objects` table so uploads (e.g. PPTX materials) still work
 * without external bucket credentials.
 */
@Injectable()
export class StorageService implements OnModuleInit {
  private readonly logger = new Logger(StorageService.name);
  private mode: StorageMode = 'db';
  private client?: S3Client;
  private endpoint = '';
  private bucket = '';
  private apiPublicUrl = '';
  private signingSecret = '';

  constructor(
    private readonly config: ConfigService,
    @Inject(PG_POOL) private readonly pool: Pool,
  ) {}

  async onModuleInit(): Promise<void> {
    this.signingSecret =
      this.config.get<string>('JWT_ACCESS_SECRET') ??
      this.config.get<string>('JWT_SECRET') ??
      'dev-storage-secret';
    this.apiPublicUrl = (
      this.config.get<string>('API_PUBLIC_URL') ??
      this.config.get<string>('PUBLIC_API_URL') ??
      ''
    ).replace(/\/+$/, '');

    const endpoint = this.config.get<string>('S3_ENDPOINT');
    const bucket = this.config.get<string>('S3_BUCKET');
    const accessKeyId = this.config.get<string>('S3_ACCESS_KEY');
    const secretAccessKey = this.config.get<string>('S3_SECRET_KEY');
    const region = this.config.get<string>('S3_REGION') ?? 'auto';

    if (endpoint && bucket && accessKeyId && secretAccessKey) {
      this.endpoint = endpoint.replace(/\/+$/, '');
      this.bucket = bucket;
      this.client = new S3Client({
        endpoint: this.endpoint,
        region,
        forcePathStyle: true,
        credentials: { accessKeyId, secretAccessKey },
      });
      this.mode = 's3';
      this.logger.log(`Storage mode=s3 bucket=${this.bucket}`);
      return;
    }

    this.mode = 'db';
    await this.ensureDbStore();
    this.logger.warn(
      'Storage mode=db (S3_* missing). Uploads persist in Postgres stored_objects. ' +
        'Set S3_ENDPOINT/S3_BUCKET/S3_ACCESS_KEY/S3_SECRET_KEY for S3/R2, and API_PUBLIC_URL for absolute upload URLs.',
    );
  }

  private async ensureDbStore(): Promise<void> {
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS "stored_objects" (
        "key" text PRIMARY KEY,
        "content_type" text NOT NULL,
        "data" bytea NOT NULL,
        "byte_size" integer NOT NULL,
        "created_at" timestamptz NOT NULL DEFAULT now()
      )
    `);
  }

  private requireS3(): S3Client {
    if (!this.client) {
      throw new ServiceUnavailableException(
        'storage_not_configured: set S3_ENDPOINT, S3_BUCKET, S3_ACCESS_KEY and S3_SECRET_KEY on the API service',
      );
    }
    return this.client;
  }

  /** Absolute API origin used for DB-mode signed URLs. */
  private apiOrigin(fallbackOrigin?: string): string {
    const origin = (this.apiPublicUrl || fallbackOrigin || '').replace(
      /\/+$/,
      '',
    );
    if (!origin) {
      throw new ServiceUnavailableException(
        'storage_not_configured: set API_PUBLIC_URL (or S3_*) on the API service',
      );
    }
    return origin;
  }

  private sign(payload: string): string {
    return createHmac('sha256', this.signingSecret)
      .update(payload)
      .digest('hex');
  }

  private verifySig(payload: string, sig: string): boolean {
    const expected = this.sign(payload);
    try {
      return timingSafeEqual(
        Buffer.from(expected, 'utf8'),
        Buffer.from(sig, 'utf8'),
      );
    } catch {
      return false;
    }
  }

  /**
   * Build a short-lived HMAC URL for DB-backed PUT/GET.
   * `kind` is `put` or `get`.
   */
  private signedDbUrl(
    kind: 'put' | 'get',
    key: string,
    ttlSeconds: number,
    fallbackOrigin?: string,
  ): string {
    const exp = Math.floor(Date.now() / 1000) + ttlSeconds;
    const payload = `${kind}:${key}:${exp}`;
    const sig = this.sign(payload);
    const origin = this.apiOrigin(fallbackOrigin);
    const q = new URLSearchParams({
      key,
      exp: String(exp),
      sig,
    });
    return `${origin}/uploads/${kind === 'put' ? 'direct' : 'file'}?${q.toString()}`;
  }

  /** Presigned `PUT` URL (valid ~60s) for uploading `key` with `contentType`. */
  async getSignedPutUrl(
    key: string,
    contentType: string,
    opts?: { requestOrigin?: string },
  ): Promise<string> {
    if (this.mode === 'db') {
      void contentType;
      return this.signedDbUrl(
        'put',
        key,
        PRESIGN_TTL_SECONDS,
        opts?.requestOrigin,
      );
    }
    const client = this.requireS3();
    const command = new PutObjectCommand({
      Bucket: this.bucket,
      Key: key,
      ContentType: contentType,
    });
    try {
      return await getSignedUrl(client, command, {
        expiresIn: PRESIGN_TTL_SECONDS,
      });
    } catch (err) {
      this.logger.error(
        `Failed to presign PUT for key=${key}: ${(err as Error).message}`,
      );
      throw new BadGatewayException('presign_failed');
    }
  }

  /**
   * Presigned `GET` URL for downloading a private object (default 5 min).
   * Used for `course-materials/` files.
   */
  async getSignedGetUrl(
    key: string,
    ttlSeconds = 300,
    opts?: { requestOrigin?: string },
  ): Promise<string> {
    if (this.mode === 'db') {
      return this.signedDbUrl(
        'get',
        key,
        ttlSeconds || DB_URL_TTL_SECONDS,
        opts?.requestOrigin,
      );
    }
    const command = new GetObjectCommand({
      Bucket: this.bucket,
      Key: key,
    });
    return getSignedUrl(this.requireS3(), command, { expiresIn: ttlSeconds });
  }

  /** Hard-delete an object (e.g. when a material file is removed). */
  async deleteObject(key: string): Promise<void> {
    if (this.mode === 'db') {
      await this.ensureDbStore();
      await this.pool.query(`DELETE FROM "stored_objects" WHERE "key" = $1`, [
        key,
      ]);
      return;
    }
    await this.requireS3().send(
      new DeleteObjectCommand({ Bucket: this.bucket, Key: key }),
    );
  }

  /**
   * Stable public URL for lesson-media objects. In DB mode this is a signed GET
   * URL (materials still store the raw key and go through /materials/:id/download).
   */
  publicUrl(key: string, opts?: { requestOrigin?: string }): string {
    if (this.mode === 'db') {
      // Materials store the key, not this URL. Lesson-media blocks may store it.
      try {
        return this.signedDbUrl(
          'get',
          key,
          PUBLIC_URL_TTL_SECONDS,
          opts?.requestOrigin,
        );
      } catch {
        return key;
      }
    }
    return `${this.endpoint}/${this.bucket}/${encodeURI(key)}`;
  }

  /** Persist bytes from a DB-mode direct PUT (HMAC-authenticated). */
  async putDirectObject(
    key: string,
    contentType: string,
    data: Buffer,
    exp: number,
    sig: string,
  ): Promise<void> {
    if (this.mode !== 'db') {
      throw new BadRequestException('direct_upload_s3_mode');
    }
    const now = Math.floor(Date.now() / 1000);
    if (!Number.isFinite(exp) || exp < now) {
      throw new BadRequestException('upload_url_expired');
    }
    if (!this.verifySig(`put:${key}:${exp}`, sig)) {
      throw new BadRequestException('upload_sig_invalid');
    }
    if (data.byteLength > MAX_DB_OBJECT_BYTES) {
      throw new BadRequestException('file_too_large');
    }
    await this.ensureDbStore();
    await this.pool.query(
      `INSERT INTO "stored_objects" ("key", "content_type", "data", "byte_size")
       VALUES ($1, $2, $3, $4)
       ON CONFLICT ("key") DO UPDATE SET
         "content_type" = EXCLUDED."content_type",
         "data" = EXCLUDED."data",
         "byte_size" = EXCLUDED."byte_size",
         "created_at" = now()`,
      [key, contentType || 'application/octet-stream', data, data.byteLength],
    );
  }

  /** Read bytes for a DB-mode signed GET. */
  async getDirectObject(
    key: string,
    exp: number,
    sig: string,
  ): Promise<{ contentType: string; data: Buffer }> {
    if (this.mode !== 'db') {
      throw new BadRequestException('direct_get_s3_mode');
    }
    const now = Math.floor(Date.now() / 1000);
    if (!Number.isFinite(exp) || exp < now) {
      throw new BadRequestException('download_url_expired');
    }
    if (!this.verifySig(`get:${key}:${exp}`, sig)) {
      throw new BadRequestException('download_sig_invalid');
    }
    await this.ensureDbStore();
    const result = await this.pool.query<{
      content_type: string;
      data: Buffer;
    }>(
      `SELECT "content_type", "data" FROM "stored_objects" WHERE "key" = $1 LIMIT 1`,
      [key],
    );
    const row = result.rows[0];
    if (!row) {
      throw new NotFoundException('object_not_found');
    }
    return {
      contentType: row.content_type || 'application/octet-stream',
      data: Buffer.isBuffer(row.data) ? row.data : Buffer.from(row.data),
    };
  }

  /** Write an object (used by multipart POST /uploads). */
  async putObject(
    key: string,
    data: Buffer,
    contentType: string,
  ): Promise<void> {
    if (this.mode === 'db') {
      if (data.byteLength > MAX_DB_OBJECT_BYTES) {
        throw new BadRequestException('file_too_large');
      }
      await this.ensureDbStore();
      await this.pool.query(
        `INSERT INTO "stored_objects" ("key", "content_type", "data", "byte_size")
         VALUES ($1, $2, $3, $4)
         ON CONFLICT ("key") DO UPDATE SET
           "content_type" = EXCLUDED."content_type",
           "data" = EXCLUDED."data",
           "byte_size" = EXCLUDED."byte_size",
           "created_at" = now()`,
        [key, contentType || 'application/octet-stream', data, data.byteLength],
      );
      return;
    }
    await this.requireS3().send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: data,
        ContentType: contentType || 'application/octet-stream',
      }),
    );
  }

  /**
   * Read an object's bytes back out by key, for trusted server-side use only
   * (e.g. `POST /lessons/:id/blocks/generate-from-file` extracting text from
   * an already-uploaded material). Unlike `getSignedGetUrl`/`getDirectObject`
   * this takes no signature — it is never called from a client-facing route,
   * only from another service after its own guard/ownership check has run.
   */
  async getObjectBuffer(key: string): Promise<Buffer> {
    if (this.mode === 'db') {
      await this.ensureDbStore();
      const result = await this.pool.query<{ data: Buffer }>(
        `SELECT "data" FROM "stored_objects" WHERE "key" = $1 LIMIT 1`,
        [key],
      );
      const row = result.rows[0];
      if (!row) {
        throw new NotFoundException('object_not_found');
      }
      return Buffer.isBuffer(row.data) ? row.data : Buffer.from(row.data);
    }

    const response = await this.requireS3().send(
      new GetObjectCommand({ Bucket: this.bucket, Key: key }),
    );
    const body = response.Body;
    if (!body) {
      throw new NotFoundException('object_not_found');
    }
    const chunks: Buffer[] = [];
    for await (const chunk of body as AsyncIterable<Buffer | Uint8Array>) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    return Buffer.concat(chunks);
  }

  getMode(): StorageMode {
    return this.mode;
  }
}
