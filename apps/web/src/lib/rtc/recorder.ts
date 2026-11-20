'use client';

/**
 * Recording of a video call, done in the host's browser.
 *
 * Picture: a Full HD (1920×1080, 30 fps) canvas with whatever is on the main
 * stage (screen share or the person who has the floor) plus the speaker in a
 * corner. Sound: every participant's audio and the host's microphone, mixed
 * with Web Audio. The result is one video file (WebM; MP4 on Safari).
 *
 * Where it goes — the host picks one:
 *   - YouTube, as an unlisted video on the host's channel;
 *   - Google Drive, folder «Уроки LMS»;
 *   - a file downloaded to the computer.
 *
 * YouTube / Drive: the video goes straight to the cloud while the lesson
 * runs, through a resumable upload session, 8 MiB at a time. Nothing of the
 * video is stored on the host's computer: only the piece not yet accepted by
 * the server is held in memory (a few seconds; longer while the internet is
 * down — then it is sent as soon as the connection is back, from where the
 * server stopped). The only thing written to disk is a few hundred bytes of
 * bookkeeping (the upload session's address), so that after a power cut or
 * a closed tab the next visit asks the service to finish the video from
 * what it already received.
 *
 * Download (the host chose a file): every few seconds are written to the
 * browser's database (IndexedDB) so a crash does not lose the lesson, and
 * the file is saved at the end.
 */

export const DRIVE_FOLDER_NAME = 'Уроки LMS';
const SCOPES = {
  drive: 'https://www.googleapis.com/auth/drive.file',
  youtube: 'https://www.googleapis.com/auth/youtube.upload',
} as const;
const DRIVE_API = 'https://www.googleapis.com/drive/v3';
const DRIVE_UPLOAD = 'https://www.googleapis.com/upload/drive/v3';
const YOUTUBE_UPLOAD = 'https://www.googleapis.com/upload/youtube/v3';
const GIS_SRC = 'https://accounts.google.com/gsi/client';
/** Google wants non-final chunks in multiples of 256 KiB. */
const CHUNK_UNIT = 256 * 1024;
const FLUSH_BYTES = 32 * CHUNK_UNIT; // 8 MiB
/** Warn the host when this much video waits in memory (the internet is down). */
const BACKLOG_WARN_BYTES = 150 * 1024 * 1024;

/** Layout is drawn in 1280×720 units and rendered at 1.5× → Full HD. */
const WIDTH = 1280;
const HEIGHT = 720;
const SCALE = 1.5;
const FPS = 30;
const VIDEO_BITS_PER_SECOND = 4_000_000;
const AUDIO_BITS_PER_SECOND = 128_000;

export type RecordingTarget = 'youtube' | 'drive' | 'download';

/** Tests shrink the flush size to exercise multi-chunk uploads quickly. */
function flushBytes(): number {
  const override = (window as unknown as { __LMS_REC_FLUSH_BYTES?: number })
    .__LMS_REC_FLUSH_BYTES;
  return typeof override === 'number' && override >= CHUNK_UNIT ? override : FLUSH_BYTES;
}

export function googleClientId(): string | null {
  return process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID?.trim() || null;
}

export function recordingSupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof MediaRecorder !== 'undefined' &&
    typeof HTMLCanvasElement !== 'undefined' &&
    'captureStream' in HTMLCanvasElement.prototype
  );
}

export interface RecordingResult {
  /** Where the file ended up. */
  where: RecordingTarget;
  fileName: string;
  /** Link to the video (YouTube) or file (Drive). */
  link?: string;
  bytes: number;
  /** YouTube: `unlisted`, or `private` when YouTube forced it. */
  privacy?: string;
  /** Why the chosen cloud target was not used (shown to the host). */
  cloudError?: string;
  /** YouTube via the LMS server: the recording waiting there to be sent. */
  serverRecordingId?: string;
  /** The server is already sending it to YouTube. */
  serverSending?: boolean;
}

export interface RecorderScene {
  /** Main picture. */
  main: MediaStream | null;
  mainMirror?: boolean;
  /** Fit the whole frame (screen share) instead of filling the canvas. */
  mainContain?: boolean;
  /** Name drawn when there is no picture, and as a caption. */
  label: string;
  /** Small picture in the corner (speaker during a screen share). */
  pip?: MediaStream | null;
  pipMirror?: boolean;
}

/** Where the audio-only copy for the AI lesson review goes. */
export interface AudioOnlySink {
  write(blob: Blob): void;
  finish(): Promise<unknown>;
}

const SPEECH_BITS_PER_SECOND = 24_000;

export interface CallRecorder {
  /** Where the file is going right now. */
  readonly target: RecordingTarget;
  setScene(scene: RecorderScene): void;
  /** All streams whose audio should be in the recording. */
  setAudio(streams: MediaStream[]): void;
  /** Finish the file. `onProgress` reports the final upload (0…1). */
  stop(onProgress?: (fraction: number) => void): Promise<RecordingResult>;
  /** Called if the recorder dies on its own (e.g. out of disk). */
  onError: ((message: string) => void) | null;
}

// ── Google sign-in ───────────────────────────────────────────────────────────

interface TokenResponse {
  access_token?: string;
  error?: string;
}
interface GoogleOauth2 {
  initTokenClient(config: {
    client_id: string;
    scope: string;
    callback: (res: TokenResponse) => void;
    error_callback?: (err: { type?: string; message?: string }) => void;
    include_granted_scopes?: boolean;
  }): { requestAccessToken(opts?: { prompt?: string; login_hint?: string }): void };
}

function loadGis(): Promise<GoogleOauth2> {
  const get = () =>
    (window as unknown as { google?: { accounts?: { oauth2?: GoogleOauth2 } } }).google
      ?.accounts?.oauth2;
  const ready = get();
  if (ready) return Promise.resolve(ready);
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = GIS_SRC;
    script.async = true;
    script.onload = () => {
      const api = get();
      if (api) resolve(api);
      else reject(new Error('google_unavailable'));
    };
    script.onerror = () => reject(new Error('google_unavailable'));
    document.head.appendChild(script);
  });
}

/**
 * Ask the host for permission to save into their YouTube channel or Google
 * Drive. Must be called from a click (it opens Google's window). Drive uses
 * `drive.file` (only files the LMS created); YouTube uses `youtube.upload`
 * (upload only — the LMS cannot read or delete the channel's videos).
 */
export async function requestGoogleToken(
  clientId: string,
  target: 'youtube' | 'drive',
  /** Email to pre-select in Google's account chooser (the LMS user's). */
  loginHint?: string | null,
): Promise<string> {
  const oauth2 = await loadGis();
  return new Promise<string>((resolve, reject) => {
    const client = oauth2.initTokenClient({
      client_id: clientId,
      scope: SCOPES[target],
      // Ask ONLY for this target's scope. By default Google adds every scope
      // granted earlier, and it refuses youtube.upload together with
      // drive.file («scopes that cannot be requested together»).
      include_granted_scopes: false,
      callback: (res) => {
        if (res.access_token) resolve(res.access_token);
        else reject(new Error(res.error ?? 'google_denied'));
      },
      error_callback: (err) => reject(new Error(err.type ?? 'google_denied')),
    });
    // Always show the account chooser: with several Google accounts in the
    // browser, Google would otherwise silently pick one — and a wrong one is
    // refused («access_denied») while the app is limited to test users.
    client.requestAccessToken({
      prompt: 'select_account',
      ...(loginHint ? { login_hint: loginHint } : {}),
    });
  });
}

async function googleJson<T>(token: string, url: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: { authorization: `Bearer ${token}`, ...(init.headers ?? {}) },
  });
  if (!res.ok) throw new Error(`google_${res.status}`);
  return (await res.json()) as T;
}

/** Find the «Уроки LMS» folder made by this app, or create it. */
async function ensureDriveFolder(token: string): Promise<string> {
  const q = encodeURIComponent(
    `name = '${DRIVE_FOLDER_NAME}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false`,
  );
  const found = await googleJson<{ files?: { id: string }[] }>(
    token,
    `${DRIVE_API}/files?q=${q}&fields=files(id)&spaces=drive`,
  );
  const existing = found.files?.[0]?.id;
  if (existing) return existing;
  const created = await googleJson<{ id: string }>(token, `${DRIVE_API}/files?fields=id`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      name: DRIVE_FOLDER_NAME,
      mimeType: 'application/vnd.google-apps.folder',
    }),
  });
  return created.id;
}

/** Open a resumable upload session; returns its URL (valid for days, needs no token). */
async function openUploadSession(
  target: 'youtube' | 'drive',
  token: string,
  meta: { fileName: string; title: string; mimeType: string },
): Promise<string> {
  let url: string;
  let body: unknown;
  if (target === 'drive') {
    const folderId = await ensureDriveFolder(token);
    url = `${DRIVE_UPLOAD}/files?uploadType=resumable&fields=id`;
    body = { name: meta.fileName, parents: [folderId], mimeType: meta.mimeType };
  } else {
    url = `${YOUTUBE_UPLOAD}/videos?uploadType=resumable&part=snippet,status`;
    body = {
      snippet: {
        title: meta.title.slice(0, 100),
        description: 'Запись урока · AI Research Labs LMS',
        categoryId: '27', // Education
      },
      // «Доступ по ссылке»: not listed on the channel, opens by link.
      status: { privacyStatus: 'unlisted', selfDeclaredMadeForKids: false },
    };
  }
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json; charset=UTF-8',
      'x-upload-content-type': meta.mimeType,
    },
    body: JSON.stringify(body),
  });
  const sessionUrl = res.headers.get('location');
  if (!res.ok || !sessionUrl) throw new Error(`${target}_${res.status}`);
  return sessionUrl;
}

function linkFor(target: 'youtube' | 'drive', id: string): string {
  return target === 'youtube'
    ? `https://youtu.be/${id}`
    : `https://drive.google.com/file/d/${id}/view`;
}

// ── local safety copy (IndexedDB) ────────────────────────────────────────────

const DB_NAME = 'lms-recordings';
const META = 'meta';
const CHUNKS = 'chunks';

export interface SavedRecording {
  recId: string;
  fileName: string;
  title: string;
  mimeType: string;
  target: RecordingTarget;
  /** Resumable upload session, if a cloud upload was started. */
  sessionUrl: string | null;
  createdAt: number;
  updatedAt: number;
  bytes: number;
  /** Streamed to the cloud: no video bytes are kept locally, only this record. */
  streamOnly?: boolean;
  /** Bytes the cloud has confirmed (stream-only recordings). */
  committed?: number;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(META)) db.createObjectStore(META, { keyPath: 'recId' });
      if (!db.objectStoreNames.contains(CHUNKS)) db.createObjectStore(CHUNKS);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('idb_failed'));
  });
}

function tx<T>(
  db: IDBDatabase,
  stores: string[],
  mode: IDBTransactionMode,
  run: (t: IDBTransaction) => IDBRequest<T> | void,
): Promise<T | undefined> {
  return new Promise((resolve, reject) => {
    const t = db.transaction(stores, mode);
    let result: T | undefined;
    const req = run(t);
    if (req) req.onsuccess = () => (result = req.result);
    t.oncomplete = () => resolve(result);
    t.onerror = () => reject(t.error ?? new Error('idb_failed'));
    t.onabort = () => reject(t.error ?? new Error('idb_aborted'));
  });
}

/** `recId:000042` — sorts in recording order. */
const chunkKey = (recId: string, seq: number) => `${recId}:${String(seq).padStart(6, '0')}`;
const chunkRange = (recId: string) => IDBKeyRange.bound(`${recId}:`, `${recId}:￿`);

class LocalCopy {
  private seq = 0;
  private chain: Promise<unknown> = Promise.resolve();
  broken = false;

  private constructor(
    private readonly db: IDBDatabase,
    readonly meta: SavedRecording,
  ) {}

  static async create(meta: SavedRecording): Promise<LocalCopy | null> {
    try {
      const db = await openDb();
      await tx(db, [META], 'readwrite', (t) => t.objectStore(META).put(meta));
      return new LocalCopy(db, meta);
    } catch {
      return null; // private mode / no disk — recording still works in memory
    }
  }

  /** Queue a chunk for writing (order is kept; errors mark the copy broken). */
  add(blob: Blob): void {
    if (this.broken) return;
    const key = chunkKey(this.meta.recId, this.seq++);
    this.meta.bytes += blob.size;
    this.meta.updatedAt = Date.now();
    const meta = { ...this.meta };
    this.chain = this.chain
      .then(() =>
        tx(this.db, [META, CHUNKS], 'readwrite', (t) => {
          t.objectStore(CHUNKS).put(blob, key);
          t.objectStore(META).put(meta);
        }),
      )
      .catch(() => {
        this.broken = true;
      });
  }

  /** Stream-only: update the bookkeeping record (no video bytes). */
  touch(bytes: number, committed: number): void {
    if (this.broken) return;
    this.meta.bytes = bytes;
    this.meta.committed = committed;
    this.meta.updatedAt = Date.now();
    const meta = { ...this.meta };
    this.chain = this.chain
      .then(() => tx(this.db, [META], 'readwrite', (t) => t.objectStore(META).put(meta)))
      .catch(() => {
        this.broken = true;
      });
  }

  setSession(sessionUrl: string | null, target: RecordingTarget): void {
    this.meta.sessionUrl = sessionUrl;
    this.meta.target = target;
    const meta = { ...this.meta };
    this.chain = this.chain
      .then(() => tx(this.db, [META], 'readwrite', (t) => t.objectStore(META).put(meta)))
      .catch(() => undefined);
  }

  async flush(): Promise<void> {
    await this.chain;
  }

  async remove(): Promise<void> {
    await this.chain.catch(() => undefined);
    await removeSavedRecording(this.meta.recId, this.db);
  }
}

async function readChunks(recId: string, db?: IDBDatabase): Promise<Blob[]> {
  const d = db ?? (await openDb());
  const blobs = await tx<Blob[]>(d, [CHUNKS], 'readonly', (t) =>
    t.objectStore(CHUNKS).getAll(chunkRange(recId)),
  );
  return blobs ?? [];
}

async function removeSavedRecording(recId: string, db?: IDBDatabase): Promise<void> {
  const d = db ?? (await openDb());
  await tx(d, [META, CHUNKS], 'readwrite', (t) => {
    t.objectStore(META).delete(recId);
    t.objectStore(CHUNKS).delete(chunkRange(recId));
  });
}

/** Recording being made in THIS tab (not offered for recovery). */
let activeRecId: string | null = null;

/**
 * Recordings that were never finished — the tab crashed, the laptop lost
 * power, the browser was closed. A recording another tab is still writing
 * (touched in the last 20 s) is left alone.
 */
export async function listUnfinishedRecordings(): Promise<SavedRecording[]> {
  if (typeof indexedDB === 'undefined') return [];
  try {
    const db = await openDb();
    const all =
      (await tx<SavedRecording[]>(db, [META], 'readonly', (t) => t.objectStore(META).getAll())) ??
      [];
    const now = Date.now();
    return all
      .filter((m) => m.recId !== activeRecId && now - m.updatedAt > 20_000 && m.bytes > 0)
      .sort((a, b) => b.createdAt - a.createdAt);
  } catch {
    return [];
  }
}

/** Everything this browser holds about lesson recordings (for the recovery tool). */
export interface BrowserRecordingFind {
  recId: string;
  meta: SavedRecording | null;
  chunks: number;
  bytes: number;
}

/**
 * Look through the browser's recording database without assumptions: every
 * bookkeeping record and every stored piece of video, also pieces whose
 * record is gone. Used to find a lesson after something went wrong.
 */
export async function scanBrowserRecordings(): Promise<BrowserRecordingFind[]> {
  if (typeof indexedDB === 'undefined') return [];
  try {
    const db = await openDb();
    const metas =
      (await tx<SavedRecording[]>(db, [META], 'readonly', (t) => t.objectStore(META).getAll())) ?? [];
    const keys =
      ((await tx<IDBValidKey[]>(db, [CHUNKS], 'readonly', (t) => t.objectStore(CHUNKS).getAllKeys())) ??
        []) as string[];
    const found = new Map<string, BrowserRecordingFind>();
    for (const m of metas) found.set(m.recId, { recId: m.recId, meta: m, chunks: 0, bytes: 0 });
    for (const k of keys) {
      const recId = String(k).split(':')[0] ?? String(k);
      const f = found.get(recId) ?? { recId, meta: null, chunks: 0, bytes: 0 };
      f.chunks += 1;
      found.set(recId, f);
    }
    for (const f of found.values()) {
      if (f.chunks > 0) {
        const blobs = await readChunks(f.recId, db);
        f.bytes = blobs.reduce((n, b) => n + b.size, 0);
      } else {
        f.bytes = f.meta?.bytes ?? 0;
      }
    }
    return [...found.values()].sort((a, b) => (b.meta?.createdAt ?? 0) - (a.meta?.createdAt ?? 0));
  } catch {
    return [];
  }
}

/** Save the video pieces this browser holds for a recording as one file. */
export async function downloadBrowserRecording(recId: string, fileName: string): Promise<number> {
  const blobs = await readChunks(recId);
  const type = blobs.find((b) => b.type)?.type || 'video/webm';
  const file = new Blob(blobs, { type });
  if (file.size > 0) downloadBlob(file, fileName);
  return file.size;
}

export async function discardSavedRecording(recId: string): Promise<void> {
  await removeSavedRecording(recId).catch(() => undefined);
}

// ── resumable upload ─────────────────────────────────────────────────────────

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

class UploadGone extends Error {}
class StreamingUnsupported extends Error {}

/**
 * One Google resumable upload session (Drive and YouTube speak the same
 * protocol). Survives network drops: after a failed request it asks the
 * server how much it has and continues from there, for as long as it takes.
 */
class ResumableUpload {
  /** Bytes the server has confirmed. */
  committed = 0;
  aborted = false;

  /** Google sign-in sent with every request (YouTube wants it on each one). */
  authToken: string | null = null;

  constructor(
    private readonly sessionUrl: string,
    committed = 0,
  ) {
    this.committed = committed;
  }

  private auth(): Record<string, string> {
    return this.authToken ? { authorization: `Bearer ${this.authToken}` } : {};
  }

  /** Ask the server how many bytes it holds (also detects a finished file). */
  async status(total: number | null): Promise<{ done: boolean; id?: string; privacy?: string }> {
    const res = await fetch(this.sessionUrl, {
      method: 'PUT',
      headers: { ...this.auth(), 'content-range': `bytes */${total ?? '*'}` },
    });
    if (res.status === 308) {
      const range = res.headers.get('range');
      const m = range ? /bytes=0-(\d+)/.exec(range) : null;
      this.committed = m ? Number(m[1]) + 1 : 0;
      return { done: false };
    }
    if (res.ok) return { done: true, ...(await parseDone(res)) };
    if (res.status === 404 || res.status === 410) throw new UploadGone(`gone_${res.status}`);
    throw new Error(`status_${res.status}`);
  }

  /**
   * Send `blob`, which starts at byte `start` of the file. `total` is the
   * final size when this is the last piece, else null. Retries through
   * network failures until it succeeds, the session is gone, or `abort()`.
   */
  async send(
    blob: Blob,
    start: number,
    total: number | null,
    patience = Infinity,
  ): Promise<{ done: boolean; id?: string; privacy?: string }> {
    let failures = 0;
    for (;;) {
      if (this.aborted) throw new Error('aborted');
      const skip = Math.max(0, this.committed - start);
      const body = skip ? blob.slice(skip) : blob;
      const from = start + skip;
      const end = start + blob.size - 1;
      if (body.size === 0 && total == null) return { done: false };
      const range =
        body.size === 0 ? `bytes */${total}` : `bytes ${from}-${end}/${total ?? '*'}`;
      try {
        const res = await fetch(this.sessionUrl, {
          method: 'PUT',
          headers: { ...this.auth(), 'content-range': range },
          body,
        });
        if (res.status === 308) {
          const r = res.headers.get('range');
          const m = r ? /bytes=0-(\d+)/.exec(r) : null;
          this.committed = m ? Number(m[1]) + 1 : end + 1;
          if (this.committed > end) return { done: false };
          continue; // server kept only part of it — send the rest
        }
        if (res.ok) {
          this.committed = end + 1;
          return { done: true, ...(await parseDone(res)) };
        }
        if (res.status === 404 || res.status === 410) throw new UploadGone(`gone_${res.status}`);
        // A 4xx on a chunk of unknown total: this service wants the size up front.
        if (res.status >= 400 && res.status < 500 && total == null && this.committed === 0) {
          throw new StreamingUnsupported(`chunk_${res.status}`);
        }
        if (res.status >= 400 && res.status < 500) throw new Error(`upload_${res.status}`);
      } catch (err) {
        if (err instanceof UploadGone || err instanceof StreamingUnsupported) throw err;
        if (err instanceof Error && /^upload_4/.test(err.message)) throw err;
        /* network down or 5xx — wait and resume below */
      }
      failures++;
      if (failures > patience) throw new Error('upload_stalled');
      await sleep(Math.min(15_000, 1500 * failures));
      // Find out what the server really has before sending again.
      try {
        const st = await this.status(total);
        if (st.done) return st;
      } catch (err) {
        if (err instanceof UploadGone) throw err;
      }
    }
  }
}

async function parseDone(res: Response): Promise<{ id?: string; privacy?: string }> {
  const json = (await res.json().catch(() => ({}))) as {
    id?: string;
    status?: { privacyStatus?: string };
  };
  return { id: json.id, privacy: json.status?.privacyStatus };
}

/** Streams recorder output into a session while the lesson goes on. */
class LiveUpload {
  private pending: Blob[] = [];
  private pendingBytes = 0;
  /** File offset of the first pending byte. */
  private offset = 0;
  private chain: Promise<void> = Promise.resolve();
  failed: Error | null = null;
  /** Called once when the stream fails for good (e.g. the service refuses it). */
  onFail: ((err: Error) => void) | null = null;
  /** Bytes recorded but not yet confirmed by the server (held in memory). */
  get backlog(): number {
    return this.offset + this.pendingBytes - this.upload.committed;
  }

  constructor(readonly upload: ResumableUpload) {}

  write(blob: Blob): void {
    if (this.failed) return;
    this.pending.push(blob);
    this.pendingBytes += blob.size;
    if (this.pendingBytes < flushBytes()) return;
    const all = new Blob(this.pending);
    const sendBytes = Math.floor(all.size / CHUNK_UNIT) * CHUNK_UNIT;
    const piece = all.slice(0, sendBytes);
    const rest = all.slice(sendBytes);
    this.pending = rest.size ? [rest] : [];
    this.pendingBytes = rest.size;
    const start = this.offset;
    this.offset += sendBytes;
    this.chain = this.chain
      .then(async () => {
        // No copy on disk: keep retrying for as long as it takes (the
        // piece waits in memory; backoff tops out at 15 s).
        if (!this.failed) await this.upload.send(piece, start, null, Number.MAX_SAFE_INTEGER);
      })
      .catch((err: unknown) => {
        if (this.failed) return;
        this.failed = err instanceof Error ? err : new Error('upload_failed');
        this.onFail?.(this.failed);
      });
  }

  async finish(): Promise<{ id?: string; privacy?: string }> {
    await this.chain;
    if (this.failed) throw this.failed;
    const tail = new Blob(this.pending);
    const total = this.offset + tail.size;
    // The last piece gets a long patience (about half an hour of retries):
    // there is no copy on disk to fall back to.
    const res = await this.upload.send(tail, this.offset, total, 120);
    if (!res.done) throw new Error('upload_incomplete');
    return res;
  }

  /**
   * Last resort when the tail cannot be sent: ask the service to finish the
   * video from the bytes it already has (the last seconds are lost).
   */
  async finalizeWhatArrived(): Promise<{ done: boolean; id?: string; privacy?: string }> {
    let st: { done: boolean; id?: string; privacy?: string } | null = null;
    try {
      st = await this.upload.status(null);
    } catch (err) {
      if (err instanceof UploadGone) throw err;
    }
    if (st?.done) return st;
    if (this.upload.committed <= 0) return { done: false };
    return this.upload.status(this.upload.committed);
  }
}

/** Upload a finished file (known size) piece by piece, with progress. */
async function uploadWhole(
  upload: ResumableUpload,
  file: Blob,
  onProgress?: (fraction: number) => void,
  patience = 40,
): Promise<{ id?: string; privacy?: string }> {
  const total = file.size;
  const step = flushBytes();
  let pos = upload.committed;
  onProgress?.(total ? pos / total : 1);
  for (;;) {
    const end = Math.min(total, pos + step);
    const last = end >= total;
    const res = await upload.send(file.slice(pos, end), pos, last ? total : null, patience);
    if (res.done) {
      onProgress?.(1);
      return res;
    }
    pos = Math.max(end, upload.committed);
    onProgress?.(total ? Math.min(1, pos / total) : 1);
    if (last) throw new Error('upload_incomplete');
  }
}

// ── picture + sound ──────────────────────────────────────────────────────────

function pickMimeType(): string {
  const options = [
    'video/webm;codecs=vp9,opus',
    'video/webm;codecs=vp8,opus',
    'video/webm',
    'video/mp4',
  ];
  return options.find((m) => MediaRecorder.isTypeSupported(m)) ?? '';
}

function hiddenVideo(): HTMLVideoElement {
  const v = document.createElement('video');
  v.muted = true;
  v.playsInline = true;
  v.autoplay = true;
  return v;
}

function setSource(v: HTMLVideoElement, stream: MediaStream | null | undefined): void {
  const next = stream && stream.getVideoTracks().length ? stream : null;
  if (v.srcObject === next) return;
  v.srcObject = next;
  if (next) void v.play().catch(() => undefined);
}

function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? '?') + (parts[1]?.[0] ?? '')).toUpperCase();
}

/** A ticker that keeps its pace in a background tab (timers there slow to 1/s). */
function startTicker(fps: number, tick: () => void): () => void {
  try {
    const src = `setInterval(() => postMessage(0), ${Math.round(1000 / fps)});`;
    const url = URL.createObjectURL(new Blob([src], { type: 'text/javascript' }));
    const worker = new Worker(url);
    worker.onmessage = tick;
    return () => {
      worker.terminate();
      URL.revokeObjectURL(url);
    };
  } catch {
    const id = window.setInterval(tick, 1000 / fps);
    return () => window.clearInterval(id);
  }
}

function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

function fileStamp(d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}-${p(d.getMinutes())}`;
}

function newRecId(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(8)), (b) =>
    b.toString(16).padStart(2, '0'),
  ).join('');
}

/**
 * Start recording. With `target` youtube/drive and a `token` (from
 * `requestGoogleToken`) the file is streamed to the cloud during the lesson;
 * otherwise it is downloaded when recording stops.
 */
/** How the recorder talks to the LMS server (YouTube target). */
export interface RecordingRelay {
  create(title: string, mimeType: string): Promise<{ id: string }>;
  putPiece(id: string, offset: number, piece: Blob): Promise<{ size: number }>;
  complete(id: string): Promise<unknown>;
}

/**
 * Streams the recording to the LMS server while the lesson runs. Pieces stay
 * in memory only until the server confirms them; network trouble is retried
 * for as long as it takes (the server answers where it stopped).
 */
class RelayUpload {
  private pending: Blob[] = [];
  private pendingBytes = 0;
  /** Bytes the server has confirmed. */
  confirmed = 0;
  /** Bytes handed to the queue (confirmed + in flight + pending). */
  private queued = 0;
  private chain: Promise<void> = Promise.resolve();
  failed: Error | null = null;
  onFail: ((err: Error) => void) | null = null;
  constructor(
    readonly relay: RecordingRelay,
    readonly id: string,
  ) {}
  get backlog(): number {
    return this.queued + this.pendingBytes - this.confirmed;
  }
  write(blob: Blob): void {
    if (this.failed) return;
    this.pending.push(blob);
    this.pendingBytes += blob.size;
    if (this.pendingBytes >= flushBytes()) this.flush();
  }
  private flush(): void {
    if (!this.pendingBytes) return;
    const piece = new Blob(this.pending);
    const start = this.queued;
    this.queued += piece.size;
    this.pending = [];
    this.pendingBytes = 0;
    this.chain = this.chain
      .then(() => this.send(piece, start))
      .catch((err: unknown) => {
        if (this.failed) return;
        this.failed = err instanceof Error ? err : new Error('upload_failed');
        this.onFail?.(this.failed);
      });
  }
  private async send(piece: Blob, start: number): Promise<void> {
    let failures = 0;
    for (;;) {
      if (this.confirmed >= start + piece.size) return;
      const from = Math.max(start, this.confirmed);
      try {
        const { size } = await this.relay.putPiece(this.id, from, piece.slice(from - start));
        this.confirmed = Math.max(this.confirmed, size);
        if (this.confirmed >= start + piece.size) return;
        // The server has less than expected: resend from its size.
        if (size < from) throw new Error('lost_bytes');
      } catch (err) {
        const gap = err as { size?: number; status?: number; message?: string };
        if (typeof gap.size === 'number') {
          if (gap.size < start) throw new Error('lost_bytes');
          this.confirmed = Math.max(this.confirmed, gap.size);
          if (/not_recording/.test(gap.message ?? '')) throw new Error('not_recording');
          continue;
        }
        // A 4xx other than auth/limits is final; everything else is retried.
        if (gap.status && gap.status >= 400 && gap.status < 500 && ![401, 408, 429].includes(gap.status)) {
          throw err instanceof Error ? err : new Error('upload_failed');
        }
      }
      failures++;
      await sleep(Math.min(15_000, 1000 * failures));
    }
  }
  async finish(): Promise<void> {
    this.flush();
    await this.chain;
    if (this.failed) throw this.failed;
    // Several tries (the tab may be closing soon after); the server keeps
    // what it has either way.
    for (let i = 0; i < 5; i++) {
      try {
        await this.relay.complete(this.id);
        return;
      } catch {
        await sleep(1500 * (i + 1));
      }
    }
  }
}

export async function startCallRecording(opts: {
  title: string;
  target: RecordingTarget;
  token?: string | null;
  /**
   * Receives a second, speech-quality audio-only recording (small enough to
   * send to the server piece by piece) — the input of the AI lesson review.
   */
  audioSink?: (mimeType: string) => AudioOnlySink | null;
  /** YouTube target: stream to the LMS server, which sends it to YouTube. */
  relay?: RecordingRelay | null;
}): Promise<CallRecorder> {
  const mimeType = pickMimeType();
  const ext = mimeType.startsWith('video/mp4') ? 'mp4' : 'webm';
  const safeTitle = opts.title.replace(/[\\/:*?"<>|]+/g, ' ').trim().slice(0, 80) || 'Урок';
  const stamp = fileStamp();
  const fileName = `${safeTitle} — ${stamp}.${ext}`;
  const title = `${safeTitle} — ${stamp}`;
  const baseType = mimeType.split(';')[0] || 'video/webm';
  const cloud = opts.target === 'download' ? null : opts.target;

  let cloudError: string | undefined;
  let sessionUrl: string | null = null;
  let relayed: RelayUpload | null = null;
  if (cloud === 'youtube' && opts.relay) {
    try {
      const rec = await opts.relay.create(title, baseType);
      relayed = new RelayUpload(opts.relay, rec.id);
    } catch (err) {
      cloudError = err instanceof Error ? err.message : 'server_failed';
    }
  } else if (cloud && opts.token) {
    try {
      sessionUrl = await openUploadSession(cloud, opts.token, {
        fileName,
        title,
        mimeType: baseType,
      });
    } catch (err) {
      cloudError = err instanceof Error ? err.message : 'cloud_failed';
    }
  } else if (cloud) {
    cloudError = 'google_denied';
  }
  const live: LiveUpload | null = sessionUrl
    ? new LiveUpload(new ResumableUpload(sessionUrl))
    : null;

  const recId = newRecId();
  activeRecId = recId;
  const now = Date.now();
  /** Streaming to the cloud: no video is kept on this computer. */
  const streamOnly = !!(live && cloud);
  // Relayed: the server keeps everything; nothing at all on this computer.
  const local = relayed ? null : await LocalCopy.create({
    recId,
    fileName,
    title,
    mimeType: baseType,
    target: live && cloud ? cloud : 'download',
    sessionUrl,
    createdAt: now,
    updatedAt: now,
    bytes: 0,
    streamOnly,
    committed: 0,
  });
  /** Download target without a disk (private mode): the file is kept in memory. */
  const memory: Blob[] = [];

  // Picture.
  const canvas = document.createElement('canvas');
  canvas.width = WIDTH * SCALE;
  canvas.height = HEIGHT * SCALE;
  const ctx = canvas.getContext('2d', { alpha: false })!;
  const mainVideo = hiddenVideo();
  const pipVideo = hiddenVideo();
  let scene: RecorderScene = { main: null, label: '' };

  const drawVideo = (
    v: HTMLVideoElement,
    x: number,
    y: number,
    w: number,
    h: number,
    contain: boolean,
    mirror: boolean,
  ) => {
    const vw = v.videoWidth;
    const vh = v.videoHeight;
    if (!vw || !vh) return false;
    const scale = contain ? Math.min(w / vw, h / vh) : Math.max(w / vw, h / vh);
    const dw = vw * scale;
    const dh = vh * scale;
    ctx.save();
    ctx.beginPath();
    ctx.rect(x, y, w, h);
    ctx.clip();
    if (mirror) {
      ctx.translate(x + w, y);
      ctx.scale(-1, 1);
      ctx.drawImage(v, (w - dw) / 2, (h - dh) / 2, dw, dh);
    } else {
      ctx.drawImage(v, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh);
    }
    ctx.restore();
    return true;
  };

  ctx.imageSmoothingQuality = 'high';
  const draw = () => {
    ctx.setTransform(SCALE, 0, 0, SCALE, 0, 0);
    ctx.fillStyle = '#0a0a0a';
    ctx.fillRect(0, 0, WIDTH, HEIGHT);
    const drawn =
      !!scene.main &&
      drawVideo(mainVideo, 0, 0, WIDTH, HEIGHT, !!scene.mainContain, !!scene.mainMirror);
    if (!drawn && scene.label) {
      ctx.fillStyle = '#5b50c8';
      ctx.beginPath();
      ctx.arc(WIDTH / 2, HEIGHT / 2 - 30, 90, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#ffffff';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.font = '600 72px system-ui, sans-serif';
      ctx.fillText(initialsOf(scene.label), WIDTH / 2, HEIGHT / 2 - 26);
      ctx.font = '500 34px system-ui, sans-serif';
      ctx.fillText(scene.label, WIDTH / 2, HEIGHT / 2 + 110, WIDTH - 80);
    } else if (scene.label) {
      ctx.font = '500 22px system-ui, sans-serif';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      const w = Math.min(ctx.measureText(scene.label).width + 28, WIDTH - 40);
      ctx.fillStyle = 'rgba(0,0,0,0.6)';
      ctx.fillRect(20, 20, w, 40);
      ctx.fillStyle = '#ffffff';
      ctx.fillText(scene.label, 34, 41, w - 28);
    }
    if (scene.pip) {
      const pw = 288;
      const ph = 162;
      const px = WIDTH - pw - 24;
      const py = HEIGHT - ph - 24;
      ctx.fillStyle = '#171717';
      ctx.fillRect(px - 3, py - 3, pw + 6, ph + 6);
      drawVideo(pipVideo, px, py, pw, ph, false, !!scene.pipMirror);
    }
  };
  draw();
  const stopTicker = startTicker(FPS, draw);
  const canvasStream = canvas.captureStream(FPS);

  // Sound.
  const AudioCtx =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  const audioCtx = new AudioCtx();
  void audioCtx.resume().catch(() => undefined);
  const mix = audioCtx.createMediaStreamDestination();
  // A silent source keeps the audio track producing data from the first second.
  const keepAlive = audioCtx.createConstantSource();
  const mute = audioCtx.createGain();
  mute.gain.value = 0;
  keepAlive.connect(mute).connect(mix);
  keepAlive.start();
  /** audio track id → node */
  const sources = new Map<string, MediaStreamAudioSourceNode>();

  const recorded = new MediaStream([
    ...canvasStream.getVideoTracks(),
    ...mix.stream.getAudioTracks(),
  ]);
  const recorder = new MediaRecorder(recorded, {
    ...(mimeType ? { mimeType } : {}),
    videoBitsPerSecond: VIDEO_BITS_PER_SECOND,
    audioBitsPerSecond: AUDIO_BITS_PER_SECOND,
  });
  let bytes = 0;
  recorder.ondataavailable = (e) => {
    if (!e.data || e.data.size === 0) return;
    bytes += e.data.size;
    if (relayed) {
      relayed.write(e.data);
      if (relayed.backlog > BACKLOG_WARN_BYTES && !backlogWarned) {
        backlogWarned = true;
        api.onError?.('upload_backlog');
      } else if (relayed.backlog < BACKLOG_WARN_BYTES / 4) {
        backlogWarned = false;
      }
      return;
    }
    if (streamOnly && live) {
      live.write(e.data);
      local?.touch(bytes, live.upload.committed);
      // Internet down for a while: tell the host (the video waits in memory).
      if (live.backlog > BACKLOG_WARN_BYTES && !backlogWarned) {
        backlogWarned = true;
        api.onError?.('upload_backlog');
      } else if (live.backlog < BACKLOG_WARN_BYTES / 4) {
        backlogWarned = false;
      }
      return;
    }
    if (local && !local.broken) local.add(e.data);
    else memory.push(e.data);
  };
  let backlogWarned = false;
  if (relayed) relayed.onFail = () => api.onError?.('upload_failed');
  if (live) {
    live.onFail = (err) => api.onError?.(err instanceof StreamingUnsupported ? 'stream_refused' : 'upload_failed');
  }

  /** The whole file, from disk (or memory when there is no disk). */
  const wholeFile = async (): Promise<Blob> => {
    if (local && !local.broken) {
      await local.flush();
      return new Blob(await readChunks(recId), { type: baseType });
    }
    return new Blob(memory, { type: baseType });
  };

  // Audio-only copy for the AI review (never blocks or breaks the recording).
  let speech: MediaRecorder | null = null;
  let speechSink: AudioOnlySink | null = null;
  try {
    const speechType = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'].find((m) =>
      MediaRecorder.isTypeSupported(m),
    );
    speechSink = speechType && opts.audioSink ? opts.audioSink(speechType.split(';')[0]!) : null;
    if (speechSink && speechType) {
      const sink = speechSink;
      speech = new MediaRecorder(new MediaStream(mix.stream.getAudioTracks()), {
        mimeType: speechType,
        audioBitsPerSecond: SPEECH_BITS_PER_SECOND,
      });
      speech.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) sink.write(e.data);
      };
      speech.start(5000);
    }
  } catch {
    speech = null;
  }

  let stopped: Promise<RecordingResult> | null = null;
  const api: CallRecorder = {
    get target() {
      if (relayed) return 'youtube';
      return live && cloud ? cloud : 'download';
    },
    onError: null,
    setScene(next) {
      scene = next;
      setSource(mainVideo, next.main);
      setSource(pipVideo, next.pip ?? null);
    },
    setAudio(streams) {
      const wanted = new Map<string, MediaStreamTrack>();
      for (const s of streams) {
        for (const t of s.getAudioTracks()) {
          if (t.readyState === 'live') wanted.set(t.id, t);
        }
      }
      for (const [id, node] of sources) {
        if (wanted.has(id)) continue;
        node.disconnect();
        sources.delete(id);
      }
      for (const [id, track] of wanted) {
        if (sources.has(id)) continue;
        try {
          const node = audioCtx.createMediaStreamSource(new MediaStream([track]));
          node.connect(mix);
          sources.set(id, node);
        } catch {
          /* a track that just ended — skip */
        }
      }
    },
    stop(onProgress) {
      if (stopped) return stopped;
      stopped = (async (): Promise<RecordingResult> => {
        if (recorder.state !== 'inactive') {
          await new Promise<void>((resolve) => {
            recorder.addEventListener('stop', () => resolve(), { once: true });
            recorder.stop();
          });
        }
        if (speech && speech.state !== 'inactive') {
          const s = speech;
          await new Promise<void>((resolve) => {
            s.addEventListener('stop', () => resolve(), { once: true });
            s.stop();
          });
        }
        // Hand the audio over for analysis; the video is saved regardless.
        void speechSink?.finish().catch(() => undefined);
        stopTicker();
        canvasStream.getTracks().forEach((t) => t.stop());
        for (const node of sources.values()) node.disconnect();
        sources.clear();
        mainVideo.srcObject = null;
        pipVideo.srcObject = null;
        void audioCtx.close().catch(() => undefined);

        const finish = async (res: RecordingResult): Promise<RecordingResult> => {
          await local?.remove().catch(() => undefined);
          if (activeRecId === recId) activeRecId = null;
          return res;
        };

        if (relayed) {
          if (activeRecId === recId) activeRecId = null;
          try {
            await relayed.finish();
            return { where: 'youtube', fileName, bytes, serverRecordingId: relayed.id };
          } catch (err) {
            // What arrived is kept on the server and can still be sent.
            return {
              where: 'youtube',
              fileName,
              bytes: relayed.confirmed,
              serverRecordingId: relayed.confirmed > 0 ? relayed.id : undefined,
              cloudError: relayed.confirmed > 0 ? 'partial' : 'server_failed',
            };
          }
        }

        if (streamOnly && live && cloud) {
          try {
            const done = await live.finish();
            if (done.id) {
              return finish({ where: cloud, fileName, bytes, link: linkFor(cloud, done.id), privacy: done.privacy });
            }
            cloudError = 'no_id';
          } catch (err) {
            cloudError = err instanceof Error ? err.message : 'cloud_failed';
            if (err instanceof StreamingUnsupported || err instanceof UploadGone) {
              // Nothing to finish later.
              return finish({ where: cloud, fileName, bytes: 0, cloudError: 'refused' });
            }
            // The tail could not be sent: finish the video from what arrived.
            try {
              const done = await live.finalizeWhatArrived();
              if (done.id) {
                return finish({
                  where: cloud,
                  fileName,
                  bytes,
                  link: linkFor(cloud, done.id),
                  privacy: done.privacy,
                  cloudError: 'partial',
                });
              }
              if (live.upload.committed <= 0) {
                return finish({ where: cloud, fileName, bytes: 0, cloudError: 'nothing_uploaded' });
              }
            } catch {
              /* no internet at all: the bookkeeping record stays, the next
                 visit finishes the video */
            }
          }
          if (activeRecId === recId) activeRecId = null;
          return { where: cloud, fileName, bytes, cloudError: 'offline' };
        }

        if (live && cloud) {
          try {
            const done = await live.finish();
            if (done.id) {
              return finish({
                where: cloud,
                fileName,
                bytes,
                link: linkFor(cloud, done.id),
                privacy: done.privacy,
              });
            }
            cloudError = 'no_id';
          } catch (err) {
            // The service refused a stream of unknown length: upload the
            // finished file through a fresh session instead.
            if (err instanceof StreamingUnsupported && opts.token) {
              try {
                const file = await wholeFile();
                const url = await openUploadSession(cloud, opts.token, {
                  fileName,
                  title,
                  mimeType: baseType,
                });
                local?.setSession(url, cloud);
                const done = await uploadWhole(new ResumableUpload(url), file, onProgress);
                if (done.id) {
                  return finish({
                    where: cloud,
                    fileName,
                    bytes,
                    link: linkFor(cloud, done.id),
                    privacy: done.privacy,
                  });
                }
                cloudError = 'no_id';
              } catch (e2) {
                cloudError = e2 instanceof Error ? e2.message : 'cloud_failed';
              }
            } else {
              cloudError = err instanceof Error ? err.message : 'cloud_failed';
            }
          }
        }
        downloadBlob(await wholeFile(), fileName);
        return finish({ where: 'download', fileName, bytes, cloudError });
      })();
      return stopped;
    },
  };
  recorder.onerror = () => api.onError?.('recorder_failed');
  if (!live && local) local.setSession(null, 'download');
  recorder.start(4000);
  return api;
}

/**
 * Save a recording that was left unfinished (crash, power cut, closed tab):
 * complete its cloud upload if the session is still alive, else download it.
 */
export async function recoverRecording(
  rec: SavedRecording,
  onProgress?: (fraction: number) => void,
  /** Google sign-in for the service (YouTube asks for it on every request). */
  authToken?: string | null,
): Promise<RecordingResult> {
  if (rec.streamOnly && rec.sessionUrl && (rec.target === 'youtube' || rec.target === 'drive')) {
    // Nothing of the video is on this computer: ask the service to finish
    // the video from what it received before the crash.
    const upload = new ResumableUpload(rec.sessionUrl);
    upload.authToken = authToken ?? null;
    const live = new LiveUpload(upload);
    try {
      let done = await live.finalizeWhatArrived();
      // The service may not tell how much it holds (hidden header): use the
      // amount it confirmed during the lesson.
      if (!done.id && !done.done && (rec.committed ?? 0) > 0) {
        done = await upload.status(rec.committed!);
      }
      if (done.id) {
        await discardSavedRecording(rec.recId);
        return { fileName: rec.fileName, bytes: live.upload.committed, where: rec.target, link: linkFor(rec.target, done.id), privacy: done.privacy, cloudError: 'partial' };
      }
      // Keep the record: a later try (another Google account, the internet
      // back) may still finish it.
      return { fileName: rec.fileName, bytes: 0, where: rec.target, cloudError: 'offline' };
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'cloud_failed';
      if (/^gone_/.test(msg)) {
        await discardSavedRecording(rec.recId);
        return { fileName: rec.fileName, bytes: 0, where: rec.target, cloudError: 'refused' };
      }
      return { fileName: rec.fileName, bytes: 0, where: rec.target, cloudError: 'offline' };
    }
  }
  const file = new Blob(await readChunks(rec.recId), { type: rec.mimeType });
  const base = { fileName: rec.fileName, bytes: file.size };
  let cloudError: string | undefined;
  if (rec.sessionUrl && (rec.target === 'youtube' || rec.target === 'drive')) {
    try {
      const upload = new ResumableUpload(rec.sessionUrl);
      upload.authToken = authToken ?? null;
      const st = await upload.status(null);
      const done = st.done ? st : await uploadWhole(upload, file, onProgress, 6);
      if (done.id) {
        await discardSavedRecording(rec.recId);
        return {
          ...base,
          where: rec.target,
          link: linkFor(rec.target, done.id),
          privacy: done.privacy,
        };
      }
      cloudError = 'no_id';
    } catch (err) {
      cloudError = err instanceof Error ? err.message : 'cloud_failed';
    }
  }
  downloadBlob(file, rec.fileName);
  await discardSavedRecording(rec.recId);
  return { ...base, where: 'download', cloudError };
}
