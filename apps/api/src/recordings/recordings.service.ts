import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
  ServiceUnavailableException,
} from '@nestjs/common';
import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { createWriteStream, promises as fs } from 'node:fs';
import { join } from 'node:path';
import type { Readable } from 'node:stream';
import {
  RECORDING_DRIVE_FOLDER_NAME,
  SERVER_RECORDING_PIECE_MAX_BYTES,
  SERVER_RECORDING_STALE_MS,
  type CreateServerRecordingDto,
  type ServerRecording,
  type ServerRecordingTarget,
} from '@lms/shared';
import { SessionsService } from '../sessions/sessions.service';

/** Where recordings wait until they are on YouTube / Drive (a docker volume in production). */
const DIR = process.env.RECORDINGS_DIR ?? join(process.cwd(), 'recordings-data');
/** One recording may not grow past this (≈ 4 h at the recorder's bitrate). */
const MAX_BYTES = Number(process.env.RECORDINGS_MAX_BYTES ?? 10 * 1024 ** 3);
/** Refuse new data when the disk has less than this free. */
const MIN_FREE_BYTES = Number(process.env.RECORDINGS_MIN_FREE_BYTES ?? 3 * 1024 ** 3);
/** Recordings nobody sent anywhere are removed after this long. */
const KEEP_MS = 14 * 24 * 3600_000;
/** Copies already on YouTube / Drive are kept this long (YouTube may still reject them). */
const DONE_KEEP_MS = 7 * 24 * 3600_000;
/** Overridable for tests only (a fake Google). */
const YT_UPLOAD = process.env.YOUTUBE_UPLOAD_URL ?? 'https://www.googleapis.com/upload/youtube/v3/videos';
const DRIVE_API = process.env.DRIVE_API_URL ?? 'https://www.googleapis.com/drive/v3';
const DRIVE_UPLOAD = process.env.DRIVE_UPLOAD_URL ?? 'https://www.googleapis.com/upload/drive/v3';
/** Google wants resumable chunks in multiples of 256 KiB. */
const CHUNK = 64 * 256 * 1024; // 16 MiB
/** WebM: the Cluster element id (a continuation file starts at a cluster). */
const WEBM_CLUSTER = Buffer.from([0x1f, 0x43, 0xb6, 0x75]);
const WEBM_EBML = Buffer.from([0x1a, 0x45, 0xdf, 0xa3]);

interface Meta {
  id: string;
  orgId: string;
  sessionId: string;
  /** Who started the recording (informational only — any staff of the org may act on it). */
  userId: string;
  title: string;
  /** Title without the « · часть N» suffix. */
  baseTitle?: string;
  mimeType: string;
  /** Bytes in the file on disk. */
  bytes: number;
  status: ServerRecording['status'];
  /** Older files have none: youtube. */
  target?: ServerRecordingTarget;
  part?: number;
  /** Marked ready because pieces stopped arriving (the recorder may still come back). */
  stale?: boolean;
  lastPieceAt?: string;
  progress?: number;
  youtubeId?: string;
  driveFileId?: string;
  link?: string;
  privacy?: string;
  error?: string;
  /** Resumable session at Google (lets an interrupted upload continue) and its target. */
  sessionUrl?: string;
  sessionTarget?: ServerRecordingTarget;
  /**
   * Continuation of another recording: the browser keeps counting bytes of
   * its own stream, which differ from the file here (a copied header, the
   * bytes before the first whole cluster dropped).
   */
  clientBytes?: number;
  skipToCluster?: boolean;
  parentId?: string;
  continuedBy?: string;
  createdAt: string;
  updatedAt: string;
}

interface UploadResult {
  id?: string;
  link?: string;
  privacy?: string;
}

/** What differs between YouTube and Drive; the chunk loop is shared. */
interface UploadStrategy {
  target: ServerRecordingTarget;
  /** The only origin a resumable session may point at (SSRF guard). */
  uploadOrigin: string;
  create(meta: Meta, token: string): Promise<string>;
  parseDone(res: Response): Promise<UploadResult>;
}

/** Thrown inside the upload; decides the status the recording ends in. */
class UploadError extends Error {
  constructor(
    message: string,
    /** true: try again later with a fresh sign-in (status ready); false: failed. */
    readonly retryable = false,
  ) {
    super(message);
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const baseType = (m: Meta) => m.mimeType.split(';')[0] || 'video/webm';

/**
 * Call recordings. The host's browser streams the video here while the
 * lesson runs (nothing is written on the host's computer); when the lesson
 * ends the server sends the complete file to YouTube or Google Drive with
 * its size known up front, chunk by chunk with a Google token of whoever
 * presses «send» (any staff member of the organisation), resuming after any
 * failure. The copy stays here a week after that, so a failed upload can
 * always be retried or the file downloaded.
 *
 * Handover: if the host disappears mid-lesson, the pieces stop; after
 * SERVER_RECORDING_STALE_MS the recording is marked ready so a colleague
 * can send it, and a new recording of the same session is numbered
 * «часть 2». If the host comes back before anyone sent it, recording simply
 * continues in the same file; if it was already sent, the rest goes into a
 * continuation file.
 */
@Injectable()
export class RecordingsService implements OnModuleInit {
  private readonly logger = new Logger(RecordingsService.name);
  private readonly locks = new Map<string, Promise<unknown>>();
  /** Uploads running in this process (id → token). */
  private readonly running = new Map<string, string>();
  private readonly strategies: Record<ServerRecordingTarget, UploadStrategy>;

  constructor(private readonly sessions: SessionsService) {
    this.strategies = {
      youtube: {
        target: 'youtube',
        uploadOrigin: new URL(YT_UPLOAD).origin,
        create: (meta, token) => this.ytCreate(meta, token),
        parseDone: async (res) => {
          const j = (await res.json().catch(() => ({}))) as { id?: string; status?: { privacyStatus?: string } };
          return { id: j.id, privacy: j.status?.privacyStatus, link: j.id ? `https://youtu.be/${j.id}` : undefined };
        },
      },
      drive: {
        target: 'drive',
        uploadOrigin: new URL(DRIVE_UPLOAD).origin,
        create: (meta, token) => this.driveCreate(meta, token),
        parseDone: async (res) => {
          const j = (await res.json().catch(() => ({}))) as { id?: string; webViewLink?: string };
          return {
            id: j.id,
            link: j.id ? (j.webViewLink ?? `https://drive.google.com/file/d/${j.id}/view`) : undefined,
          };
        },
      },
    };
  }

  async onModuleInit(): Promise<void> {
    await fs.mkdir(DIR, { recursive: true }).catch(() => undefined);
    // An upload cut by a restart needs a Google sign-in again (the token
    // lives only in memory); it resumes where Google stopped.
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
    const staleTimer = setInterval(() => void this.markStale().catch(() => undefined), 30_000);
    staleTimer.unref?.();
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
  /** Org scoping: a recording of another organisation does not exist. */
  private async scoped(orgId: string, id: string): Promise<Meta> {
    const meta = await this.read(id);
    if (!meta || meta.orgId !== orgId) throw new NotFoundException('recording_not_found');
    return meta;
  }
  private async hasFile(id: string): Promise<boolean> {
    return fs.stat(this.dataPath(id)).then((st) => st.size > 0).catch(() => false);
  }
  /** Position in the browser's own stream (what piece offsets refer to). */
  private streamPos(m: Meta): number {
    return m.clientBytes ?? m.bytes;
  }
  private lastPiece(m: Meta): number {
    return Date.parse(m.lastPieceAt ?? m.createdAt);
  }
  /** Pieces are still arriving (or did a moment ago). */
  private isLive(m: Meta): boolean {
    return m.status === 'recording' && Date.now() - this.lastPiece(m) < SERVER_RECORDING_STALE_MS;
  }

  /** A link that downloads the server copy for 15 minutes, without a login header. */
  async downloadLink(orgId: string, id: string): Promise<{ path: string }> {
    const meta = await this.scoped(orgId, id);
    if (!(await this.hasFile(id))) throw new NotFoundException('file_gone');
    const exp = Date.now() + 15 * 60_000;
    return { path: `/recordings/${meta.id}/file?exp=${exp}&sig=${this.sign(meta.id, exp)}` };
  }

  private sign(id: string, exp: number): string {
    const secret = process.env.JWT_ACCESS_SECRET ?? '';
    return createHmac('sha256', `recording-download:${secret}`).update(`${id}:${exp}`).digest('hex');
  }

  /** Check a download link; returns what to stream. */
  async openDownload(
    id: string,
    exp: number,
    sig: string,
  ): Promise<{ path: string; size: number; fileName: string; mimeType: string }> {
    const good = this.sign(id, exp);
    if (
      !Number.isFinite(exp) ||
      exp < Date.now() ||
      sig.length !== good.length ||
      !timingSafeEqual(Buffer.from(sig), Buffer.from(good))
    ) {
      throw new NotFoundException('link_expired');
    }
    const meta = await this.read(id);
    if (!meta || !(await this.hasFile(id))) throw new NotFoundException('file_gone');
    const st = await fs.stat(this.dataPath(id));
    return {
      path: this.dataPath(id),
      size: st.size,
      fileName: this.fileName(meta),
      mimeType: baseType(meta),
    };
  }

  private fileName(meta: Meta): string {
    const ext = meta.mimeType.includes('mp4') ? 'mp4' : 'webm';
    return `${meta.title.replace(/[\\/:*?"<>|]+/g, ' ').slice(0, 120)}.${ext}`;
  }

  private dto(m: Meta): ServerRecording {
    const target = m.target ?? 'youtube';
    return {
      id: m.id,
      sessionId: m.sessionId,
      title: m.title,
      mimeType: m.mimeType,
      bytes: m.bytes,
      status: m.status,
      target,
      part: m.part ?? 1,
      stale: m.stale || (m.status === 'recording' && !this.isLive(m)) || undefined,
      progress: m.progress,
      youtubeId: m.youtubeId,
      driveFileId: m.driveFileId,
      link: m.link ?? (m.youtubeId ? `https://youtu.be/${m.youtubeId}` : undefined),
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
    const meta = await this.newRecording({
      orgId,
      userId,
      sessionId,
      baseTitle: dto.title,
      mimeType: dto.mimeType,
      target: dto.target ?? 'youtube',
    });
    return this.dto(meta);
  }

  /**
   * A new recording file, numbered after the session's earlier recordings
   * (a colleague who takes over the lesson records «часть 2»).
   */
  private newRecording(p: {
    orgId: string;
    userId: string;
    sessionId: string;
    baseTitle: string;
    mimeType: string;
    target: ServerRecordingTarget;
    header?: Buffer;
    extra?: Partial<Meta>;
  }): Promise<Meta> {
    return this.withLock(`session:${p.sessionId}`, async () => {
      let last = 0;
      for (const m of await this.all()) {
        if (m.orgId === p.orgId && m.sessionId === p.sessionId) last = Math.max(last, m.part ?? 1);
      }
      const part = last + 1;
      const now = new Date().toISOString();
      const meta: Meta = {
        id: randomUUID(),
        orgId: p.orgId,
        sessionId: p.sessionId,
        userId: p.userId,
        title: part > 1 ? `${p.baseTitle} · часть ${part}` : p.baseTitle,
        baseTitle: p.baseTitle,
        mimeType: p.mimeType,
        bytes: p.header?.length ?? 0,
        status: 'recording',
        target: p.target,
        part,
        lastPieceAt: now,
        createdAt: now,
        updatedAt: now,
        ...p.extra,
      };
      await fs.writeFile(this.dataPath(meta.id), p.header ?? Buffer.alloc(0));
      await this.save(meta);
      return meta;
    });
  }

  /**
   * Append the piece that starts at byte `offset` of the browser's stream.
   * A piece the server already has is acknowledged again (the browser
   * retries after a network drop); a gap is refused with the size the server
   * has, so the browser resends. A recording marked ready only because its
   * pieces stopped (host offline) takes pieces again when the host is back,
   * unless someone has started sending it — then the browser is told
   * `not_recording` and continues in a new file (`continueRecording`).
   */
  async appendPiece(
    orgId: string,
    id: string,
    offset: number,
    body: Readable,
  ): Promise<{ size: number }> {
    return this.withLock(id, async () => {
      const meta = await this.scoped(orgId, id);
      if (meta.status === 'ready' && meta.stale && !this.running.has(id)) {
        // The host is back before anyone sent it: carry on in the same file.
        meta.status = 'recording';
        meta.stale = undefined;
        meta.sessionUrl = undefined;
        meta.sessionTarget = undefined;
        meta.error = undefined;
        meta.progress = undefined;
        meta.lastPieceAt = new Date().toISOString();
        await this.save(meta);
      }
      const pos = this.streamPos(meta);
      if (meta.status !== 'recording') {
        body.resume();
        throw new ConflictException({ message: 'not_recording', size: pos, continuedBy: meta.continuedBy });
      }
      if (offset !== pos) {
        body.resume();
        if (offset < pos) return { size: pos };
        throw new ConflictException({ message: 'gap', size: pos });
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
        return { size: pos };
      }
      if (meta.bytes + size > MAX_BYTES) {
        await fs.rm(part, { force: true });
        throw new BadRequestException('recording_too_large');
      }
      let data = await fs.readFile(part);
      if (meta.skipToCluster) {
        // Continuation: the file already has the header; start at a cluster.
        const at = findCluster(data);
        if (at < 0) data = Buffer.alloc(0);
        else {
          data = data.subarray(at);
          meta.skipToCluster = undefined;
        }
      }
      // A crash between writing the data and its bookkeeping (an API
      // restart) may have left bytes the meta does not count: drop them so
      // the retried piece is not stored twice.
      await fs.truncate(this.dataPath(id), meta.bytes);
      if (data.length) await fs.appendFile(this.dataPath(id), data);
      await fs.rm(part, { force: true });
      meta.bytes += data.length;
      if (meta.clientBytes != null) meta.clientBytes += size;
      meta.lastPieceAt = new Date().toISOString();
      await this.save(meta);
      return { size: this.streamPos(meta) };
    });
  }

  /**
   * The browser's recording was sent away while the host was offline: the
   * rest of its stream goes into a new file («часть N») that starts with the
   * first file's WebM header. Repeated calls return the same continuation.
   */
  async continueRecording(orgId: string, userId: string, id: string): Promise<ServerRecording> {
    return this.withLock(id, async () => {
      const parent = await this.scoped(orgId, id);
      if (parent.continuedBy) {
        const child = await this.read(parent.continuedBy);
        if (child && child.orgId === orgId) return this.dto(child);
      }
      if (parent.status === 'recording' || (parent.status === 'ready' && parent.stale && !this.running.has(id))) {
        throw new ConflictException('still_recording');
      }
      const header = await this.webmHeader(id);
      if (!header) throw new ConflictException('cannot_continue');
      const child = await this.newRecording({
        orgId,
        userId,
        sessionId: parent.sessionId,
        baseTitle: parent.baseTitle ?? parent.title,
        mimeType: parent.mimeType,
        target: parent.target ?? 'youtube',
        header,
        extra: { clientBytes: this.streamPos(parent), skipToCluster: true, parentId: parent.id },
      });
      parent.continuedBy = child.id;
      await this.save(parent);
      this.logger.log(`recording ${id}: continued in ${child.id}`);
      return this.dto(child);
    });
  }

  /** WebM header (everything before the first cluster) of a recording file. */
  private async webmHeader(id: string): Promise<Buffer | null> {
    const fh = await fs.open(this.dataPath(id), 'r').catch(() => null);
    if (!fh) return null;
    try {
      const buf = Buffer.alloc(4 * 1024 * 1024);
      const { bytesRead } = await fh.read(buf, 0, buf.length, 0);
      const head = buf.subarray(0, bytesRead);
      if (!head.subarray(0, 4).equals(WEBM_EBML)) return null;
      const at = findCluster(head);
      return at > 0 ? Buffer.from(head.subarray(0, at)) : null;
    } finally {
      await fh.close();
    }
  }

  /** The browser sent everything. */
  async complete(orgId: string, id: string): Promise<ServerRecording> {
    return this.withLock(id, async () => {
      const meta = await this.scoped(orgId, id);
      if (meta.status === 'recording' || (meta.status === 'ready' && meta.stale)) {
        meta.status = 'ready';
        meta.stale = undefined;
        await this.save(meta);
      }
      return this.dto(meta);
    });
  }

  /** Pieces stopped arriving (the host's tab closed or the internet died): let anyone send it. */
  private async markStale(): Promise<void> {
    for (const m of await this.all()) {
      if (m.status !== 'recording' || this.isLive(m)) continue;
      await this.withLock(m.id, async () => {
        const cur = await this.read(m.id);
        if (!cur || cur.status !== 'recording' || this.isLive(cur)) return;
        cur.status = 'ready';
        cur.stale = true;
        await this.save(cur);
        this.logger.log(`recording ${cur.id}: no pieces for a while — ready to send`);
      });
    }
  }

  async get(orgId: string, id: string): Promise<ServerRecording> {
    const m = await this.scoped(orgId, id);
    return { ...this.dto(m), fileKept: await this.hasFile(id) };
  }

  /** Recordings of this organisation that are not sent yet. */
  async pending(orgId: string): Promise<ServerRecording[]> {
    const list = (await this.all()).filter((m) => m.orgId === orgId && m.status !== 'done');
    const out: ServerRecording[] = [];
    for (const m of list.sort((a, b) => b.createdAt.localeCompare(a.createdAt))) {
      out.push({ ...this.dto(m), fileKept: await this.hasFile(m.id) });
    }
    return out;
  }

  async remove(orgId: string, id: string): Promise<void> {
    await this.withLock(id, async () => {
      const meta = await this.scoped(orgId, id);
      if (this.running.has(id)) throw new ConflictException('uploading');
      // Somebody is recording into it right now.
      if (this.isLive(meta)) throw new ConflictException('still_recording');
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
      if (m.status === 'done' && age > DONE_KEEP_MS) await this.removeFiles(m.id);
      else if (m.status !== 'uploading' && age > KEEP_MS) await this.removeFiles(m.id);
    }
  }

  // ── sending (YouTube / Drive) ────────────────────────────────────────────

  sendToYoutube(orgId: string, id: string, accessToken: string): Promise<ServerRecording> {
    return this.send(orgId, id, 'youtube', accessToken);
  }

  sendToDrive(orgId: string, id: string, accessToken: string): Promise<ServerRecording> {
    return this.send(orgId, id, 'drive', accessToken);
  }

  /**
   * Start (or resume) sending the recording in the background with the
   * Google token of whoever asked (any staff member of the organisation).
   */
  private send(
    orgId: string,
    id: string,
    target: ServerRecordingTarget,
    accessToken: string,
  ): Promise<ServerRecording> {
    return this.withLock(id, async () => {
      const meta = await this.scoped(orgId, id);
      if (this.running.has(id)) {
        if ((meta.target ?? 'youtube') === target) {
          this.running.set(id, accessToken); // a fresher token for the rest
          return this.dto(meta);
        }
        throw new ConflictException('uploading');
      }
      // Never cut a recording that is still being recorded.
      if (this.isLive(meta)) throw new ConflictException('still_recording');
      if (meta.status === 'done') {
        // Send again (e.g. YouTube removed it): a new upload from the kept copy.
        if (!(await this.hasFile(id))) return this.dto(meta);
        meta.sessionUrl = undefined;
      }
      if (meta.bytes === 0) throw new BadRequestException('empty_recording');
      if (meta.sessionTarget && meta.sessionTarget !== target) meta.sessionUrl = undefined;
      meta.target = target;
      meta.status = 'uploading';
      meta.error = undefined;
      meta.progress = 0;
      await this.save(meta);
      this.running.set(id, accessToken);
      void this.runUpload(id, this.strategies[target]).finally(() => this.running.delete(id));
      return this.dto(meta);
    });
  }

  private async runUpload(id: string, s: UploadStrategy): Promise<void> {
    const token = () => this.running.get(id) ?? '';
    const t = s.target;
    let meta = (await this.read(id))!;
    const size = meta.bytes;
    try {
      let offset = 0;
      if (meta.sessionUrl) {
        const st = await this.queryStatus(s, meta.sessionUrl, size, token());
        if (st.done) return await this.finishDone(id, s, st);
        if (st.gone) meta.sessionUrl = undefined;
        else offset = st.committed;
      }
      if (!meta.sessionUrl) {
        const url = await s.create(meta, token());
        // Defence in depth (SSRF): only ever talk to Google's own upload host.
        if (new URL(url).origin !== s.uploadOrigin) throw new UploadError(`${t}_bad_location`);
        meta.sessionUrl = url;
        meta.sessionTarget = t;
        await this.save(meta);
        offset = 0;
      }
      const fh = await fs.open(this.dataPath(id), 'r');
      try {
        let failures = 0;
        while (offset < size) {
          const len = Math.min(CHUNK, size - offset);
          const buf = Buffer.alloc(len);
          await fh.read(buf, 0, len, offset);
          let res: Response | null = null;
          try {
            res = await fetch(meta.sessionUrl!, {
              method: 'PUT',
              headers: {
                authorization: `Bearer ${token()}`,
                'content-length': String(len),
                'content-type': baseType(meta),
                'content-range': `bytes ${offset}-${offset + len - 1}/${size}`,
              },
              body: buf,
              signal: AbortSignal.timeout(5 * 60_000),
            });
          } catch {
            res = null;
          }
          if (res && (res.status === 200 || res.status === 201)) {
            return await this.finishDone(id, s, await s.parseDone(res));
          }
          if (res && res.status === 308) {
            offset = rangeEnd(res) ?? offset + len;
            failures = 0;
            meta = (await this.read(id))!;
            meta.progress = offset / size;
            await this.save(meta);
            continue;
          }
          let retry = !res || res.status >= 500 || res.status === 408 || res.status === 429;
          if (res && !retry) {
            const text = await res.text().catch(() => '');
            if (res.status === 401) throw new UploadError('google_signin_expired', true);
            // Drive answers 403 to rate limits; those are worth waiting for.
            if (res.status === 403 && /rateLimitExceeded/i.test(text)) retry = true;
            else {
              if (res.status === 404 || res.status === 410) {
                meta.sessionUrl = undefined; // session expired: start a new one next time
                await this.save(meta);
              }
              throw new UploadError(`${t}_${res.status} ${text.slice(0, 200)}`);
            }
          }
          // Network trouble, 5xx or a rate limit: ask Google where it stopped, then go on.
          failures++;
          if (failures > 40) throw new UploadError(`${t}_unreachable`, true);
          await sleep(Math.min(30_000, 1000 * 2 ** Math.min(failures, 5)));
          const st = await this.queryStatus(s, meta.sessionUrl!, size, token()).catch((e: unknown) => {
            if (e instanceof UploadError && e.message === 'google_signin_expired') throw e;
            return null;
          });
          if (st?.done) return await this.finishDone(id, s, st);
          if (st && !st.gone) offset = st.committed;
        }
        // All bytes sent but no final answer yet: ask.
        const st = await this.queryStatus(s, meta.sessionUrl!, size, token());
        if (st.done) return await this.finishDone(id, s, st);
        throw new UploadError(`${t}_incomplete`, true);
      } finally {
        await fh.close();
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const retryable = err instanceof UploadError ? err.retryable : true;
      this.logger.warn(`recording ${id}: ${t} upload failed: ${msg.slice(0, 160)}`);
      const m = await this.read(id);
      if (m) {
        m.status = retryable ? 'ready' : 'failed';
        m.error = msg.slice(0, 300);
        await this.save(m);
      }
    }
  }

  private async queryStatus(
    s: UploadStrategy,
    url: string,
    size: number,
    token: string,
  ): Promise<UploadResult & { done: boolean; gone?: boolean; committed: number }> {
    const res = await fetch(url, {
      method: 'PUT',
      headers: { authorization: `Bearer ${token}`, 'content-length': '0', 'content-range': `bytes */${size}` },
      signal: AbortSignal.timeout(60_000),
    });
    if (res.status === 200 || res.status === 201) return { done: true, committed: size, ...(await s.parseDone(res)) };
    if (res.status === 308) return { done: false, committed: rangeEnd(res) ?? 0 };
    if (res.status === 404 || res.status === 410) return { done: false, gone: true, committed: 0 };
    if (res.status === 401) throw new UploadError('google_signin_expired', true);
    throw new UploadError(`${s.target}_status_${res.status}`, res.status >= 500);
  }

  private async ytCreate(meta: Meta, token: string): Promise<string> {
    const res = await fetch(`${YT_UPLOAD}?uploadType=resumable&part=snippet,status`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json; charset=UTF-8',
        'x-upload-content-length': String(meta.bytes),
        'x-upload-content-type': baseType(meta),
      },
      body: JSON.stringify({
        snippet: { title: meta.title.slice(0, 100), categoryId: '27' },
        status: { privacyStatus: 'unlisted', selfDeclaredMadeForKids: false },
      }),
      signal: AbortSignal.timeout(60_000),
    });
    return this.sessionLocation(res, 'youtube');
  }

  /** Find the LMS folder in the user's Drive (drive.file sees only what the LMS made), or create it. */
  private async driveFolder(token: string): Promise<string> {
    const name = RECORDING_DRIVE_FOLDER_NAME.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
    const q = `name = '${name}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false`;
    const auth = { authorization: `Bearer ${token}` };
    const found = await fetch(`${DRIVE_API}/files?q=${encodeURIComponent(q)}&fields=files(id)&spaces=drive&pageSize=10`, {
      headers: auth,
      signal: AbortSignal.timeout(60_000),
    });
    if (found.status === 401) throw new UploadError('google_signin_expired', true);
    if (!found.ok) {
      throw new UploadError(`drive_folder_${found.status} ${(await found.text().catch(() => '')).slice(0, 200)}`, found.status >= 500);
    }
    const existing = ((await found.json()) as { files?: { id?: string }[] }).files?.find((f) => f.id)?.id;
    if (existing) return existing;
    const created = await fetch(`${DRIVE_API}/files?fields=id`, {
      method: 'POST',
      headers: { ...auth, 'content-type': 'application/json; charset=UTF-8' },
      body: JSON.stringify({ name: RECORDING_DRIVE_FOLDER_NAME, mimeType: 'application/vnd.google-apps.folder' }),
      signal: AbortSignal.timeout(60_000),
    });
    if (created.status === 401) throw new UploadError('google_signin_expired', true);
    const j = (await created.json().catch(() => ({}))) as { id?: string };
    if (!created.ok || !j.id) throw new UploadError(`drive_folder_create_${created.status}`, created.status >= 500);
    return j.id;
  }

  private async driveCreate(meta: Meta, token: string): Promise<string> {
    const folderId = await this.driveFolder(token);
    const res = await fetch(`${DRIVE_UPLOAD}/files?uploadType=resumable&fields=id,webViewLink`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json; charset=UTF-8',
        'x-upload-content-length': String(meta.bytes),
        'x-upload-content-type': baseType(meta),
      },
      body: JSON.stringify({ name: this.fileName(meta), parents: [folderId], mimeType: baseType(meta) }),
      signal: AbortSignal.timeout(60_000),
    });
    return this.sessionLocation(res, 'drive');
  }

  private async sessionLocation(res: Response, t: ServerRecordingTarget): Promise<string> {
    const location = res.headers.get('location');
    if (!res.ok || !location) {
      const text = await res.text().catch(() => '');
      if (res.status === 401) throw new UploadError('google_signin_expired', true);
      throw new UploadError(`${t}_create_${res.status} ${text.slice(0, 300)}`, res.status >= 500);
    }
    return location;
  }

  private async finishDone(id: string, s: UploadStrategy, st: UploadResult): Promise<void> {
    const m = await this.read(id);
    if (!m) return;
    if (!st.id) {
      m.status = 'failed';
      m.error = `${s.target}_no_id`;
      await this.save(m);
      return;
    }
    m.status = 'done';
    m.target = s.target;
    m.stale = undefined;
    if (s.target === 'youtube') {
      m.youtubeId = st.id;
      m.privacy = st.privacy;
    } else {
      m.driveFileId = st.id;
    }
    m.link = st.link;
    m.progress = 1;
    m.error = undefined;
    m.sessionUrl = undefined;
    m.sessionTarget = undefined;
    await this.save(m);
    // The server copy is kept for a week: YouTube can still reject a video
    // after accepting it (e.g. «too long» for a channel without phone
    // verification) — then it can be downloaded or sent again.
    this.logger.log(`recording ${id}: on ${s.target}`);
  }
}

function rangeEnd(res: Response): number | null {
  const r = res.headers.get('range');
  const m = r ? /bytes=0-(\d+)/.exec(r) : null;
  return m ? Number(m[1]) + 1 : null;
}

/**
 * Offset of the first WebM Cluster in `buf` (id, a valid size, then the
 * cluster Timestamp element), or -1.
 */
export function findCluster(buf: Buffer, from = 0): number {
  for (let at = buf.indexOf(WEBM_CLUSTER, from); at >= 0; at = buf.indexOf(WEBM_CLUSTER, at + 1)) {
    const first = buf[at + 4];
    if (first === undefined || first === 0) continue;
    const len = Math.clz32(first) - 23; // 1..8 bytes of size
    if (buf[at + 4 + len] === 0xe7) return at;
  }
  return -1;
}
