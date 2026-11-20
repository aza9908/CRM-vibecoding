import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
  ServiceUnavailableException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { createWriteStream, promises as fs } from 'node:fs';
import { join } from 'node:path';
import type { Readable } from 'node:stream';
import {
  SERVER_RECORDING_PIECE_MAX_BYTES,
  type CreateServerRecordingDto,
  type ServerRecording,
} from '@lms/shared';
import { SessionsService } from '../sessions/sessions.service';

/** Where recordings wait until they are on YouTube (a docker volume in production). */
const DIR = process.env.RECORDINGS_DIR ?? join(process.cwd(), 'recordings-data');
/** One recording may not grow past this (≈ 4 h at the recorder's bitrate). */
const MAX_BYTES = Number(process.env.RECORDINGS_MAX_BYTES ?? 10 * 1024 ** 3);
/** Refuse new data when the disk has less than this free. */
const MIN_FREE_BYTES = Number(process.env.RECORDINGS_MIN_FREE_BYTES ?? 3 * 1024 ** 3);
/** Recordings nobody sent anywhere are removed after this long. */
const KEEP_MS = 14 * 24 * 3600_000;
const YT_UPLOAD = process.env.YOUTUBE_UPLOAD_URL ?? 'https://www.googleapis.com/upload/youtube/v3/videos';
/** YouTube chunks must be multiples of 256 KiB. */
const YT_CHUNK = 64 * 256 * 1024; // 16 MiB

interface Meta {
  id: string;
  orgId: string;
  sessionId: string;
  userId: string;
  title: string;
  mimeType: string;
  bytes: number;
  status: ServerRecording['status'];
  progress?: number;
  youtubeId?: string;
  privacy?: string;
  error?: string;
  /** YouTube resumable session (lets an interrupted upload continue). */
  sessionUrl?: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * Call recordings, YouTube target. The host's browser streams the video here
 * while the lesson runs (nothing is written on the host's computer); when the
 * lesson ends the server sends the complete file to YouTube with its size
 * known up front, chunk by chunk with the host's Google token, resuming after
 * any failure, and deletes its copy once YouTube has the video. Until then
 * the recording is kept here, so a failed upload can always be retried.
 */
@Injectable()
export class RecordingsService implements OnModuleInit {
  private readonly logger = new Logger(RecordingsService.name);
  private readonly locks = new Map<string, Promise<unknown>>();
  /** Uploads running in this process (id → token). */
  private readonly running = new Map<string, string>();

  constructor(private readonly sessions: SessionsService) {}

  async onModuleInit(): Promise<void> {
    await fs.mkdir(DIR, { recursive: true }).catch(() => undefined);
    // An upload cut by a restart needs the host's sign-in again (the token
    // lives only in memory); it resumes where YouTube stopped.
    for (const meta of await this.all()) {
      if (meta.status === 'uploading') {
        meta.status = 'ready';
        meta.error = 'interrupted';
        await this.save(meta);
      }
    }
    const timer = setInterval(() => void this.cleanup(), 6 * 3600_000);
    timer.unref?.();
    void this.cleanup();
  }

  // ── files ────────────────────────────────────────────────────────────────

  private dataPath(id: string) {
    return join(DIR, `${id}.video`);
  }
  private metaPath(id: string) {
    return join(DIR, `${id}.json`);
  }
  private async read(id: string): Promise<Meta | null> {
    if (!/^[0-9a-f-]{36}$/.test(id)) return null;
    try {
      return JSON.parse(await fs.readFile(this.metaPath(id), 'utf8')) as Meta;
    } catch {
      return null;
    }
  }
  private async save(meta: Meta): Promise<void> {
    meta.updatedAt = new Date().toISOString();
    const tmp = this.metaPath(meta.id) + '.tmp';
    await fs.writeFile(tmp, JSON.stringify(meta));
    await fs.rename(tmp, this.metaPath(meta.id));
  }
  private async all(): Promise<Meta[]> {
    const names = await fs.readdir(DIR).catch(() => [] as string[]);
    const out: Meta[] = [];
    for (const n of names) {
      if (!n.endsWith('.json')) continue;
      const m = await this.read(n.slice(0, -5));
      if (m) out.push(m);
    }
    return out;
  }
  private withLock<T>(id: string, fn: () => Promise<T>): Promise<T> {
    const prev = this.locks.get(id) ?? Promise.resolve();
    const next = prev.catch(() => undefined).then(fn);
    this.locks.set(id, next);
    void next.finally(() => {
      if (this.locks.get(id) === next) this.locks.delete(id);
    }).catch(() => undefined);
    return next;
  }
  private async scoped(orgId: string, id: string): Promise<Meta> {
    const meta = await this.read(id);
    if (!meta || meta.orgId !== orgId) throw new NotFoundException('recording_not_found');
    return meta;
  }
  private dto(m: Meta): ServerRecording {
    return {
      id: m.id,
      sessionId: m.sessionId,
      title: m.title,
      mimeType: m.mimeType,
      bytes: m.bytes,
      status: m.status,
      progress: m.progress,
      youtubeId: m.youtubeId,
      privacy: m.privacy,
      error: m.error,
      createdAt: m.createdAt,
      updatedAt: m.updatedAt,
    };
  }

  // ── intake ───────────────────────────────────────────────────────────────

  async create(
    orgId: string,
    userId: string,
    sessionId: string,
    dto: CreateServerRecordingDto,
  ): Promise<ServerRecording> {
    await this.sessions.assertSessionInOrg(sessionId, orgId);
    await this.assertDiskSpace();
    const now = new Date().toISOString();
    const meta: Meta = {
      id: randomUUID(),
      orgId,
      sessionId,
      userId,
      title: dto.title,
      mimeType: dto.mimeType,
      bytes: 0,
      status: 'recording',
      createdAt: now,
      updatedAt: now,
    };
    await fs.writeFile(this.dataPath(meta.id), Buffer.alloc(0));
    await this.save(meta);
    return this.dto(meta);
  }

  /**
   * Append the piece that starts at byte `offset`. A piece the server already
   * has is acknowledged again (the browser retries after a network drop); a
   * gap is refused with the size the server has, so the browser resends.
   */
  async appendPiece(
    orgId: string,
    id: string,
    offset: number,
    body: Readable,
  ): Promise<{ size: number }> {
    return this.withLock(id, async () => {
      const meta = await this.scoped(orgId, id);
      if (meta.status !== 'recording') {
        body.resume();
        throw new ConflictException({ message: 'not_recording', size: meta.bytes });
      }
      if (offset !== meta.bytes) {
        body.resume();
        if (offset < meta.bytes) return { size: meta.bytes };
        throw new ConflictException({ message: 'gap', size: meta.bytes });
      }
      await this.assertDiskSpace();
      // Write to a side file first: a cut connection leaves no half piece.
      const part = this.dataPath(id) + '.part';
      let size = 0;
      await new Promise<void>((resolve, reject) => {
        const out = createWriteStream(part);
        body.on('data', (c: Buffer) => {
          size += c.length;
          if (size > SERVER_RECORDING_PIECE_MAX_BYTES) {
            body.destroy(new Error('piece_too_large'));
          }
        });
        body.on('error', reject);
        out.on('error', reject);
        out.on('finish', () => resolve());
        body.pipe(out);
      }).catch(async (err: unknown) => {
        await fs.rm(part, { force: true }).catch(() => undefined);
        throw new BadRequestException(err instanceof Error ? err.message : 'piece_failed');
      });
      if (size === 0) {
        await fs.rm(part, { force: true });
        return { size: meta.bytes };
      }
      if (meta.bytes + size > MAX_BYTES) {
        await fs.rm(part, { force: true });
        throw new BadRequestException('recording_too_large');
      }
      await fs.appendFile(this.dataPath(id), await fs.readFile(part));
      await fs.rm(part, { force: true });
      meta.bytes += size;
      await this.save(meta);
      return { size: meta.bytes };
    });
  }

  /** The browser sent everything. */
  async complete(orgId: string, id: string): Promise<ServerRecording> {
    return this.withLock(id, async () => {
      const meta = await this.scoped(orgId, id);
      if (meta.status === 'recording') {
        meta.status = 'ready';
        await this.save(meta);
      }
      return this.dto(meta);
    });
  }

  async get(orgId: string, id: string): Promise<ServerRecording> {
    return this.dto(await this.scoped(orgId, id));
  }

  /** Recordings of this organisation that are not on YouTube yet. */
  async pending(orgId: string): Promise<ServerRecording[]> {
    const list = (await this.all()).filter((m) => m.orgId === orgId && m.status !== 'done');
    return list
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .map((m) => this.dto(m));
  }

  async remove(orgId: string, id: string): Promise<void> {
    await this.withLock(id, async () => {
      const meta = await this.scoped(orgId, id);
      if (this.running.has(id)) throw new ConflictException('uploading');
      await this.removeFiles(meta.id);
    });
  }

  private async removeFiles(id: string): Promise<void> {
    await fs.rm(this.dataPath(id), { force: true }).catch(() => undefined);
    await fs.rm(this.dataPath(id) + '.part', { force: true }).catch(() => undefined);
    await fs.rm(this.metaPath(id), { force: true }).catch(() => undefined);
  }

  private async assertDiskSpace(): Promise<void> {
    try {
      const st = await fs.statfs(DIR);
      if (st.bavail * st.bsize < MIN_FREE_BYTES) {
        throw new ServiceUnavailableException('server_disk_full');
      }
    } catch (err) {
      if (err instanceof ServiceUnavailableException) throw err;
    }
  }

  private async cleanup(): Promise<void> {
    const now = Date.now();
    for (const m of await this.all()) {
      const age = now - Date.parse(m.updatedAt);
      if (m.status === 'done' && age > 24 * 3600_000) await this.removeFiles(m.id);
      else if (m.status !== 'uploading' && age > KEEP_MS) await this.removeFiles(m.id);
    }
  }

  // ── YouTube ──────────────────────────────────────────────────────────────

  /** Start (or resume) sending the recording to YouTube in the background. */
  async sendToYoutube(orgId: string, id: string, accessToken: string): Promise<ServerRecording> {
    return this.withLock(id, async () => {
      const meta = await this.scoped(orgId, id);
      if (meta.status === 'done') return this.dto(meta);
      if (this.running.has(id)) {
        this.running.set(id, accessToken); // a fresher token for the rest
        return this.dto(meta);
      }
      if (meta.status === 'recording') meta.status = 'ready';
      if (meta.bytes === 0) throw new BadRequestException('empty_recording');
      meta.status = 'uploading';
      meta.error = undefined;
      meta.progress = 0;
      await this.save(meta);
      this.running.set(id, accessToken);
      void this.runUpload(id).finally(() => this.running.delete(id));
      return this.dto(meta);
    });
  }

  private async runUpload(id: string): Promise<void> {
    const token = () => this.running.get(id) ?? '';
    let meta = (await this.read(id))!;
    const size = meta.bytes;
    try {
      let offset = 0;
      if (meta.sessionUrl) {
        const st = await this.ytStatus(meta.sessionUrl, size, token());
        if (st.done) return await this.finishDone(id, st);
        if (st.gone) meta.sessionUrl = undefined;
        else offset = st.committed;
      }
      if (!meta.sessionUrl) {
        meta.sessionUrl = await this.ytCreate(meta, token());
        await this.save(meta);
        offset = 0;
      }
      const fh = await fs.open(this.dataPath(id), 'r');
      try {
        let failures = 0;
        while (offset < size) {
          const len = Math.min(YT_CHUNK, size - offset);
          const buf = Buffer.alloc(len);
          await fh.read(buf, 0, len, offset);
          let res: Response | null = null;
          try {
            res = await fetch(meta.sessionUrl!, {
              method: 'PUT',
              headers: {
                authorization: `Bearer ${token()}`,
                'content-length': String(len),
                'content-type': meta.mimeType.split(';')[0] || 'video/webm',
                'content-range': `bytes ${offset}-${offset + len - 1}/${size}`,
              },
              body: buf,
              signal: AbortSignal.timeout(5 * 60_000),
            });
          } catch {
            res = null;
          }
          if (res && (res.status === 200 || res.status === 201)) {
            return await this.finishDone(id, await this.parseVideo(res));
          }
          if (res && res.status === 308) {
            offset = this.rangeEnd(res) ?? offset + len;
            failures = 0;
            meta = (await this.read(id))!;
            meta.progress = offset / size;
            await this.save(meta);
            continue;
          }
          if (res && (res.status === 401 || res.status === 403)) {
            const text = await res.text().catch(() => '');
            throw new Error(res.status === 401 ? 'google_signin_expired' : `youtube_403 ${text.slice(0, 200)}`);
          }
          if (res && res.status >= 400 && res.status < 500 && res.status !== 408 && res.status !== 429) {
            const text = await res.text().catch(() => '');
            if (res.status === 404 || res.status === 410) {
              meta.sessionUrl = undefined; // session expired: start a new one next time
              await this.save(meta);
            }
            throw new Error(`youtube_${res.status} ${text.slice(0, 200)}`);
          }
          // Network trouble or 5xx: ask YouTube where it stopped, then go on.
          failures++;
          if (failures > 40) throw new Error('youtube_unreachable');
          await new Promise((r) => setTimeout(r, Math.min(30_000, 1000 * 2 ** Math.min(failures, 5))));
          const st = await this.ytStatus(meta.sessionUrl!, size, token()).catch(() => null);
          if (st?.done) return await this.finishDone(id, st);
          if (st && !st.gone) offset = st.committed;
        }
        // All bytes sent but no final answer yet: ask.
        const st = await this.ytStatus(meta.sessionUrl!, size, token());
        if (st.done) return await this.finishDone(id, st);
        throw new Error('youtube_incomplete');
      } finally {
        await fh.close();
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.warn(`recording ${id}: YouTube upload failed: ${msg.slice(0, 160)}`);
      const m = await this.read(id);
      if (m) {
        m.status = msg === 'google_signin_expired' || msg === 'youtube_unreachable' ? 'ready' : 'failed';
        m.error = msg.slice(0, 300);
        await this.save(m);
      }
    }
  }

  private rangeEnd(res: Response): number | null {
    const r = res.headers.get('range');
    const m = r ? /bytes=0-(\d+)/.exec(r) : null;
    return m ? Number(m[1]) + 1 : null;
  }

  private async parseVideo(res: Response): Promise<{ id?: string; privacy?: string }> {
    const j = (await res.json().catch(() => ({}))) as { id?: string; status?: { privacyStatus?: string } };
    return { id: j.id, privacy: j.status?.privacyStatus };
  }

  private async ytStatus(
    url: string,
    size: number,
    token: string,
  ): Promise<{ done: boolean; gone?: boolean; committed: number; id?: string; privacy?: string }> {
    const res = await fetch(url, {
      method: 'PUT',
      headers: { authorization: `Bearer ${token}`, 'content-length': '0', 'content-range': `bytes */${size}` },
      signal: AbortSignal.timeout(60_000),
    });
    if (res.status === 200 || res.status === 201) return { done: true, committed: size, ...(await this.parseVideo(res)) };
    if (res.status === 308) return { done: false, committed: this.rangeEnd(res) ?? 0 };
    if (res.status === 404 || res.status === 410) return { done: false, gone: true, committed: 0 };
    if (res.status === 401) throw new Error('google_signin_expired');
    throw new Error(`youtube_status_${res.status}`);
  }

  private async ytCreate(meta: Meta, token: string): Promise<string> {
    const res = await fetch(`${YT_UPLOAD}?uploadType=resumable&part=snippet,status`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json; charset=UTF-8',
        'x-upload-content-length': String(meta.bytes),
        'x-upload-content-type': meta.mimeType.split(';')[0] || 'video/webm',
      },
      body: JSON.stringify({
        snippet: { title: meta.title.slice(0, 100), categoryId: '27' },
        status: { privacyStatus: 'unlisted', selfDeclaredMadeForKids: false },
      }),
      signal: AbortSignal.timeout(60_000),
    });
    const location = res.headers.get('location');
    if (!res.ok || !location) {
      const text = await res.text().catch(() => '');
      if (res.status === 401) throw new Error('google_signin_expired');
      throw new Error(`youtube_create_${res.status} ${text.slice(0, 300)}`);
    }
    // Defence in depth (SSRF): only ever talk to YouTube's own upload host.
    if (new URL(location).origin !== new URL(YT_UPLOAD).origin) {
      throw new Error('youtube_bad_location');
    }
    return location;
  }

  private async finishDone(id: string, st: { id?: string; privacy?: string }): Promise<void> {
    const m = await this.read(id);
    if (!m) return;
    if (!st.id) {
      m.status = 'failed';
      m.error = 'youtube_no_id';
      await this.save(m);
      return;
    }
    m.status = 'done';
    m.youtubeId = st.id;
    m.privacy = st.privacy;
    m.progress = 1;
    m.sessionUrl = undefined;
    await this.save(m);
    // YouTube has it: the server copy goes.
    await fs.rm(this.dataPath(id), { force: true }).catch(() => undefined);
    this.logger.log(`recording ${id}: on YouTube`);
  }
}
