'use client';

/**
 * Recording of a video call, done in the host's browser.
 *
 * Picture: a 1280×720 canvas with whatever is on the main stage (screen share
 * or the person who has the floor) plus the speaker in a corner. Sound: every
 * participant's audio and the host's microphone, mixed with Web Audio.
 * The result is one video file (WebM; MP4 on Safari).
 *
 * Where it goes: straight to the host's Google Drive, folder «Уроки LMS»,
 * streamed while recording (resumable upload) and closed when the host stops
 * the recording — the file appears in Drive only after that, so the host is
 * warned before closing the tab mid-recording. Without a Google client id —
 * or if Google is unreachable — the file is downloaded to the computer
 * instead. Chunks are also kept locally until the upload is confirmed, so a
 * failed upload still ends in a downloaded file.
 */

export const DRIVE_FOLDER_NAME = 'Уроки LMS';
const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.file';
const DRIVE_API = 'https://www.googleapis.com/drive/v3';
const DRIVE_UPLOAD = 'https://www.googleapis.com/upload/drive/v3';
const GIS_SRC = 'https://accounts.google.com/gsi/client';
/** Drive wants non-final chunks in multiples of 256 KiB. */
const CHUNK_UNIT = 256 * 1024;
const FLUSH_BYTES = 16 * CHUNK_UNIT; // 4 MiB
/** Tests shrink the flush size to exercise multi-chunk uploads quickly. */
function flushBytes(): number {
  const override = (window as unknown as { __LMS_REC_FLUSH_BYTES?: number })
    .__LMS_REC_FLUSH_BYTES;
  return typeof override === 'number' && override >= CHUNK_UNIT ? override : FLUSH_BYTES;
}

const WIDTH = 1280;
const HEIGHT = 720;
const FPS = 15;

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
  /** `drive` = saved to Google Drive; `download` = saved to the computer. */
  where: 'drive' | 'download';
  fileName: string;
  /** Link to the file in Drive. */
  link?: string;
  bytes: number;
  /** Why Drive was not used (shown to the host). */
  driveError?: string;
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

export interface CallRecorder {
  /** `drive` when the file is being streamed to Google Drive. */
  readonly target: 'drive' | 'download';
  setScene(scene: RecorderScene): void;
  /** All streams whose audio should be in the recording. */
  setAudio(streams: MediaStream[]): void;
  stop(): Promise<RecordingResult>;
  /** Called if the recorder dies on its own (e.g. out of disk). */
  onError: ((message: string) => void) | null;
}

// ── Google Drive ─────────────────────────────────────────────────────────────

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
 * Ask the host for permission to put files into their Google Drive. Must be
 * called from a click (it opens Google's consent window). The permission is
 * `drive.file`: the LMS can only see the files and folders it created itself.
 */
export async function requestDriveToken(
  clientId: string,
  /** Email to pre-select in Google's account chooser (the LMS user's). */
  loginHint?: string | null,
): Promise<string> {
  const oauth2 = await loadGis();
  return new Promise<string>((resolve, reject) => {
    const client = oauth2.initTokenClient({
      client_id: clientId,
      scope: DRIVE_SCOPE,
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

async function driveJson<T>(token: string, url: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: { authorization: `Bearer ${token}`, ...(init.headers ?? {}) },
  });
  if (!res.ok) throw new Error(`drive_${res.status}`);
  return (await res.json()) as T;
}

/** Find the «Уроки LMS» folder made by this app, or create it. */
async function ensureDriveFolder(token: string): Promise<string> {
  const q = encodeURIComponent(
    `name = '${DRIVE_FOLDER_NAME}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false`,
  );
  const found = await driveJson<{ files?: { id: string }[] }>(
    token,
    `${DRIVE_API}/files?q=${q}&fields=files(id)&spaces=drive`,
  );
  const existing = found.files?.[0]?.id;
  if (existing) return existing;
  const created = await driveJson<{ id: string }>(token, `${DRIVE_API}/files?fields=id`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      name: DRIVE_FOLDER_NAME,
      mimeType: 'application/vnd.google-apps.folder',
    }),
  });
  return created.id;
}

/** Streams a file of unknown length into Drive through one upload session. */
class DriveUpload {
  private offset = 0;
  private pending: Blob[] = [];
  private pendingBytes = 0;
  private chain: Promise<void> = Promise.resolve();
  failed: string | null = null;

  private constructor(private readonly sessionUrl: string) {}

  static async open(token: string, fileName: string, mimeType: string): Promise<DriveUpload> {
    const folderId = await ensureDriveFolder(token);
    const res = await fetch(`${DRIVE_UPLOAD}/files?uploadType=resumable&fields=id`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json; charset=UTF-8',
        'x-upload-content-type': mimeType,
      },
      body: JSON.stringify({ name: fileName, parents: [folderId], mimeType }),
    });
    const sessionUrl = res.headers.get('location');
    if (!res.ok || !sessionUrl) throw new Error(`drive_${res.status}`);
    return new DriveUpload(sessionUrl);
  }

  private async put(body: Blob, range: string): Promise<Response> {
    let lastError: unknown;
    for (let attempt = 0; attempt < 4; attempt++) {
      try {
        const res = await fetch(this.sessionUrl, {
          method: 'PUT',
          headers: { 'content-range': range },
          body,
        });
        // 308 = chunk stored, more expected; 200/201 = file complete.
        if (res.status === 308 || res.ok) return res;
        lastError = new Error(`drive_${res.status}`);
        if (res.status >= 400 && res.status < 500) break;
      } catch (err) {
        lastError = err;
      }
      await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
    }
    throw lastError instanceof Error ? lastError : new Error('drive_upload_failed');
  }

  /** Queue recorder output; full 256 KiB multiples are sent as they fill up. */
  write(blob: Blob): void {
    if (this.failed) return;
    this.pending.push(blob);
    this.pendingBytes += blob.size;
    if (this.pendingBytes < flushBytes()) return;
    const all = new Blob(this.pending);
    const sendBytes = Math.floor(all.size / CHUNK_UNIT) * CHUNK_UNIT;
    const send = all.slice(0, sendBytes);
    const rest = all.slice(sendBytes);
    this.pending = rest.size ? [rest] : [];
    this.pendingBytes = rest.size;
    const start = this.offset;
    this.offset += sendBytes;
    this.chain = this.chain
      .then(async () => {
        if (this.failed) return;
        await this.put(send, `bytes ${start}-${start + sendBytes - 1}/*`);
      })
      .catch((err: unknown) => {
        this.failed = err instanceof Error ? err.message : 'drive_upload_failed';
      });
  }

  /** Send the tail and close the file; returns the Drive file id. */
  async finish(): Promise<string> {
    await this.chain;
    if (this.failed) throw new Error(this.failed);
    const tail = new Blob(this.pending);
    const total = this.offset + tail.size;
    const range = tail.size
      ? `bytes ${this.offset}-${total - 1}/${total}`
      : `bytes */${total}`;
    const res = await this.put(tail, range);
    if (!res.ok) throw new Error(`drive_${res.status}`);
    const json = (await res.json().catch(() => ({}))) as { id?: string };
    if (!json.id) throw new Error('drive_no_id');
    return json.id;
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

/**
 * Start recording. `driveToken` (from `requestDriveToken`) streams the file
 * to Google Drive; without it the file is downloaded when recording stops.
 */
export async function startCallRecording(opts: {
  title: string;
  driveToken?: string | null;
}): Promise<CallRecorder> {
  const mimeType = pickMimeType();
  const ext = mimeType.startsWith('video/mp4') ? 'mp4' : 'webm';
  const safeTitle = opts.title.replace(/[\\/:*?"<>|]+/g, ' ').trim().slice(0, 80) || 'Урок';
  const fileName = `${safeTitle} — ${fileStamp()}.${ext}`;
  const baseType = mimeType.split(';')[0] || 'video/webm';

  let drive: DriveUpload | null = null;
  let driveError: string | undefined;
  if (opts.driveToken) {
    try {
      drive = await DriveUpload.open(opts.driveToken, fileName, baseType);
    } catch (err) {
      driveError = err instanceof Error ? err.message : 'drive_failed';
    }
  }

  // Picture.
  const canvas = document.createElement('canvas');
  canvas.width = WIDTH;
  canvas.height = HEIGHT;
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

  const draw = () => {
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
    videoBitsPerSecond: 1_200_000,
    audioBitsPerSecond: 96_000,
  });
  const chunks: Blob[] = [];
  let bytes = 0;
  recorder.ondataavailable = (e) => {
    if (!e.data || e.data.size === 0) return;
    chunks.push(e.data);
    bytes += e.data.size;
    drive?.write(e.data);
  };

  let stopped: Promise<RecordingResult> | null = null;
  const api: CallRecorder = {
    target: drive ? 'drive' : 'download',
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
    stop() {
      if (stopped) return stopped;
      stopped = (async (): Promise<RecordingResult> => {
        if (recorder.state !== 'inactive') {
          await new Promise<void>((resolve) => {
            recorder.addEventListener('stop', () => resolve(), { once: true });
            recorder.stop();
          });
        }
        stopTicker();
        canvasStream.getTracks().forEach((t) => t.stop());
        for (const node of sources.values()) node.disconnect();
        sources.clear();
        mainVideo.srcObject = null;
        pipVideo.srcObject = null;
        void audioCtx.close().catch(() => undefined);
        if (drive) {
          try {
            const id = await drive.finish();
            return {
              where: 'drive',
              fileName,
              bytes,
              link: `https://drive.google.com/file/d/${id}/view`,
            };
          } catch (err) {
            driveError = err instanceof Error ? err.message : 'drive_failed';
          }
        }
        downloadBlob(new Blob(chunks, { type: baseType }), fileName);
        return { where: 'download', fileName, bytes, driveError };
      })();
      return stopped;
    },
  };
  recorder.onerror = () => api.onError?.('recorder_failed');
  recorder.start(4000);
  return api;
}
