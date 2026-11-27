'use client';

import type { ImageSegmenter } from '@mediapipe/tasks-vision';
import { BASE_PATH } from '@/lib/utils';

/**
 * «Размыть фон» — background blur for one's own camera, entirely in the
 * browser.
 *
 * camera track → hidden <video> → person segmentation (MediaPipe Tasks
 * Vision ImageSegmenter, selfie model; GPU delegate, CPU fallback) →
 * canvas: blurred frame + the sharp person cut out by the mask →
 * canvas.captureStream() track, which the call sends instead of the raw
 * camera.
 *
 * The library (≈ 0.4 MB JS + an 11 MB WASM + a 0.25 MB model, all served
 * from /vendor/mediapipe on our own site) is loaded only when someone turns
 * blur on. A weak computer gets a lower resolution / frame rate first; if
 * even that is too slow the pipeline gives up with `slow` and the caller
 * goes back to the raw camera. Any error does the same — blur must never
 * break the camera.
 */

export type BlurFailure = 'unsupported' | 'slow' | 'failed';

export class BlurError extends Error {
  constructor(readonly code: BlurFailure, message?: string) {
    super(message ?? code);
  }
}

export interface BlurPipeline {
  /** The raw camera track this pipeline reads (owned by the caller). */
  readonly input: MediaStreamTrack;
  /** The blurred track to send / preview. */
  readonly output: MediaStreamTrack;
  /** Stop everything this pipeline created (never the input track). */
  stop(): void;
}

const PREF_KEY = 'lms-bg-blur';
const IMAGE_KEY = 'lms-bg-image';

/**
 * Virtual background picture (instead of the blurred room). Read every frame
 * by a running pipeline, so switching between blur and pictures is instant.
 */
let bgImage: HTMLImageElement | null = null;
let bgImageSrc: string | null = null;

/** Picture behind the person, or null for blur. Remembered in this browser. */
export function setBackgroundImage(src: string | null): void {
  try {
    if (src) window.localStorage.setItem(IMAGE_KEY, src);
    else window.localStorage.removeItem(IMAGE_KEY);
  } catch {
    /* preference only */
  }
  bgImageSrc = src;
  if (!src) {
    bgImage = null;
    return;
  }
  const img = new Image();
  img.decoding = 'async';
  img.onload = () => {
    if (bgImageSrc === src) bgImage = img;
  };
  img.src = src;
}

if (typeof window !== 'undefined') {
  const saved = (() => {
    try {
      return window.localStorage.getItem(IMAGE_KEY);
    } catch {
      return null;
    }
  })();
  if (saved) setBackgroundImage(saved);
}

export function readBackgroundImage(): string | null {
  try {
    return typeof window !== 'undefined' ? window.localStorage.getItem(IMAGE_KEY) : null;
  } catch {
    return null;
  }
}

/** Remembered choice of «Размыть фон» (this browser). */
export function readBlurPref(): boolean {
  try {
    return typeof window !== 'undefined' && window.localStorage.getItem(PREF_KEY) === '1';
  } catch {
    return false;
  }
}

export function writeBlurPref(on: boolean): void {
  try {
    window.localStorage.setItem(PREF_KEY, on ? '1' : '0');
  } catch {
    /* preference only */
  }
}

/**
 * Quick feature check without loading anything: WebAssembly, WebGL-free
 * 2D canvas with captureStream (Safari 15+, Firefox, all Chromium).
 * A real failure to start the segmenter is reported later as `unsupported`.
 */
export function blurSupported(): boolean {
  if (typeof window === 'undefined' || typeof document === 'undefined') return false;
  if (typeof WebAssembly !== 'object') return false;
  const canvas = document.createElement('canvas') as HTMLCanvasElement & {
    captureStream?: unknown;
  };
  return typeof canvas.captureStream === 'function' && !!canvas.getContext('2d');
}

// ── the segmenter (one per page, created on first use) ──────────────────────

let segmenterPromise: Promise<ImageSegmenter> | null = null;
/** CPU after the GPU delegate failed / was too slow once (or no real GPU). */
let forceCpu = false;
/** Delegate of the current segmenter. */
let currentDelegate: 'GPU' | 'CPU' = 'CPU';
let lastTimestamp = 0;
let users = 0;

/** Self-hosted MediaPipe files, in a folder per pinned package version
 * (keep in sync with @mediapipe/tasks-vision in package.json). */
const MEDIAPIPE_DIR = '/vendor/mediapipe/0.10.35';

function assetUrl(path: string): string {
  return new URL(`${BASE_PATH}${path}`, window.location.origin).href;
}

async function createSegmenter(): Promise<ImageSegmenter> {
  const { FilesetResolver, ImageSegmenter } = await import('@mediapipe/tasks-vision');
  const fileset = await FilesetResolver.forVisionTasks(assetUrl(`${MEDIAPIPE_DIR}/wasm`));
  const make = (delegate: 'GPU' | 'CPU') =>
    ImageSegmenter.createFromOptions(fileset, {
      baseOptions: {
        modelAssetPath: assetUrl(`${MEDIAPIPE_DIR}/selfie_segmenter.tflite`),
        delegate,
      },
      runningMode: 'VIDEO',
      outputCategoryMask: false,
      outputConfidenceMasks: true,
    });
  if (!forceCpu && !softwareGl()) {
    try {
      const gpu = await make('GPU');
      currentDelegate = 'GPU';
      return gpu;
    } catch (err) {
      console.warn('[blur] GPU delegate unavailable, using CPU', err);
    }
  }
  const cpu = await make('CPU');
  currentDelegate = 'CPU';
  return cpu;
}

/** WebGL drawn by the processor (no usable graphics chip / blocklisted
 * driver): the GPU delegate would be far slower than the WASM CPU path. */
function softwareGl(): boolean {
  try {
    const gl = document.createElement('canvas').getContext('webgl2') as WebGL2RenderingContext | null;
    if (!gl) return true;
    const info = gl.getExtension('WEBGL_debug_renderer_info');
    const renderer = String(
      info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER),
    );
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return /swiftshader|llvmpipe|softpipe|software|microsoft basic render/i.test(renderer);
  } catch {
    return true;
  }
}

function getSegmenter(): Promise<ImageSegmenter> {
  if (!segmenterPromise) {
    segmenterPromise = createSegmenter().catch((err: unknown) => {
      segmenterPromise = null;
      throw new BlurError('unsupported', err instanceof Error ? err.message : String(err));
    });
  }
  return segmenterPromise;
}

/** Drop the segmenter (frees the WASM memory); the next start re-creates it. */
function releaseSegmenter(): void {
  const p = segmenterPromise;
  segmenterPromise = null;
  void p?.then((s) => s.close()).catch(() => undefined);
}

function nextTimestamp(): number {
  // MediaPipe wants strictly increasing timestamps across all calls.
  const now = performance.now();
  lastTimestamp = now > lastTimestamp ? now : lastTimestamp + 1;
  return lastTimestamp;
}

// ── a timer that keeps ticking in a background tab ──────────────────────────

/** Worker timers are throttled far less than page timers in a hidden tab. */
function makeTicker(): { after: (ms: number, cb: () => void) => void; close: () => void } {
  let cb: (() => void) | null = null;
  let worker: Worker | null = null;
  let url: string | null = null;
  try {
    url = URL.createObjectURL(
      new Blob(['onmessage=function(e){setTimeout(function(){postMessage(0)},e.data)}'], {
        type: 'text/javascript',
      }),
    );
    worker = new Worker(url);
    worker.onmessage = () => {
      const fn = cb;
      cb = null;
      fn?.();
    };
  } catch {
    worker = null;
  }
  let timer: number | null = null;
  return {
    after(ms, fn) {
      cb = fn;
      if (worker) worker.postMessage(ms);
      else timer = window.setTimeout(() => {
        const f = cb;
        cb = null;
        f?.();
      }, ms);
    },
    close() {
      cb = null;
      if (timer) window.clearTimeout(timer);
      worker?.terminate();
      if (url) URL.revokeObjectURL(url);
    },
  };
}

// ── quality levels ──────────────────────────────────────────────────────────

/** Output size cap and frame rate; a slow computer steps down the list. */
const LEVELS = [
  { maxWidth: 1280, fps: 24 },
  { maxWidth: 960, fps: 20 },
  { maxWidth: 640, fps: 15 },
  { maxWidth: 480, fps: 12 },
] as const;
/** Frames slower than this (ms) for a few seconds → step down. */
const SLOW_FRAME_MS = 50;
const SLOW_WINDOW_MS = 3_000;
/** Width the person mask is computed at (the model itself works at 256). */
const MASK_WIDTH = 256;

type VideoWithRvfc = HTMLVideoElement & {
  requestVideoFrameCallback?: (cb: () => void) => number;
  cancelVideoFrameCallback?: (id: number) => void;
};

function canvasFilterWorks(ctx: CanvasRenderingContext2D): boolean {
  try {
    ctx.filter = 'blur(2px)';
    const ok = ctx.filter === 'blur(2px)';
    ctx.filter = 'none';
    return ok;
  } catch {
    return false;
  }
}

/**
 * Start blurring `input`. Resolves once the first blurred frame is drawn
 * (so nobody ever receives an empty picture); rejects with a `BlurError`.
 * `onFail` reports a later failure (too slow / runtime error); the caller
 * must then switch back to the raw track — the pipeline stops itself.
 */
export async function startBackgroundBlur(
  input: MediaStreamTrack,
  onFail: (code: BlurFailure) => void,
): Promise<BlurPipeline> {
  if (!blurSupported()) throw new BlurError('unsupported');
  if (input.readyState !== 'live') throw new BlurError('failed', 'input ended');
  users += 1;
  let segmenter: ImageSegmenter;
  try {
    segmenter = await getSegmenter();
  } catch (err) {
    users -= 1;
    throw err;
  }

  // Hidden video that plays the raw camera. It sits in the page (1 px,
  // transparent): some browsers do not decode a detached video.
  const video = document.createElement('video') as VideoWithRvfc;
  video.muted = true;
  video.playsInline = true;
  video.autoplay = true;
  video.setAttribute('aria-hidden', 'true');
  video.style.cssText =
    'position:fixed;left:0;top:0;width:1px;height:1px;opacity:0;pointer-events:none;z-index:-1';
  video.srcObject = new MediaStream([input]);
  document.body.appendChild(video);

  const out = document.createElement('canvas');
  const outCtx = out.getContext('2d');
  const segCanvas = document.createElement('canvas');
  const segCtx = segCanvas.getContext('2d', { willReadFrequently: false });
  const maskCanvas = document.createElement('canvas');
  const maskCtx = maskCanvas.getContext('2d');
  const bgCanvas = document.createElement('canvas');
  const bgCtx = bgCanvas.getContext('2d');
  const tinyCanvas = document.createElement('canvas');
  const tinyCtx = tinyCanvas.getContext('2d');
  const ticker = makeTicker();

  let stopped = false;
  let output: MediaStreamTrack | null = null;
  const cleanup = () => {
    if (stopped) return;
    stopped = true;
    ticker.close();
    document.removeEventListener('visibilitychange', onVisibility);
    input.removeEventListener('ended', onInputEnded);
    output?.stop();
    video.pause();
    video.srcObject = null;
    video.remove();
    users -= 1;
    // Nobody blurs any more: free the WASM memory (re-created when needed).
    if (users <= 0) {
      users = 0;
      releaseSegmenter();
    }
  };
  const onInputEnded = () => cleanup();
  input.addEventListener('ended', onInputEnded);

  try {
    if (!outCtx || !segCtx || !maskCtx || !bgCtx || !tinyCtx) {
      throw new BlurError('unsupported', 'no 2d canvas');
    }
    await Promise.race([
      video.play(),
      new Promise((_, reject) => window.setTimeout(() => reject(new Error('play timeout')), 5_000)),
    ]);
    // Wait for the real frame size.
    const t0 = performance.now();
    while (!video.videoWidth && performance.now() - t0 < 4_000) {
      await new Promise((r) => window.setTimeout(r, 50));
    }
    if (!video.videoWidth) throw new BlurError('failed', 'no frames');
  } catch (err) {
    cleanup();
    throw err instanceof BlurError ? err : new BlurError('failed', String(err));
  }

  const useFilter = canvasFilterWorks(bgCtx);
  let level = 0;
  let maskData: ImageData | null = null;

  /** Fit all canvases to the camera size and the current level. */
  const layout = () => {
    const vw = video.videoWidth || 640;
    const vh = video.videoHeight || 360;
    const cap = LEVELS[level]!.maxWidth;
    const scale = Math.min(1, cap / vw);
    const w = Math.max(2, Math.round((vw * scale) / 2) * 2);
    const h = Math.max(2, Math.round((vh * scale) / 2) * 2);
    if (out.width !== w || out.height !== h) {
      out.width = w;
      out.height = h;
    }
    const mw = MASK_WIDTH;
    const mh = Math.max(2, Math.round((MASK_WIDTH * vh) / vw));
    if (segCanvas.width !== mw || segCanvas.height !== mh) {
      segCanvas.width = mw;
      segCanvas.height = mh;
    }
    // Background: blurred at a quarter size (cheap), scaled back up.
    const bw = Math.max(2, Math.round(w / 4));
    const bh = Math.max(2, Math.round(h / 4));
    if (bgCanvas.width !== bw || bgCanvas.height !== bh) {
      bgCanvas.width = bw;
      bgCanvas.height = bh;
    }
    const tw = Math.max(2, Math.round(w / 24));
    const th = Math.max(2, Math.round(h / 24));
    if (tinyCanvas.width !== tw || tinyCanvas.height !== th) {
      tinyCanvas.width = tw;
      tinyCanvas.height = th;
    }
  };

  /** One frame: segment → composite. Returns the time it took (ms). */
  const drawFrame = (): number => {
    const start = performance.now();
    layout();
    const W = out.width;
    const H = out.height;
    segCtx.drawImage(video, 0, 0, segCanvas.width, segCanvas.height);
    const result = segmenter.segmentForVideo(segCanvas, nextTimestamp());
    try {
      const mask = result.confidenceMasks?.[0];
      if (!mask) throw new Error('no mask');
      const mw = mask.width;
      const mh = mask.height;
      const conf = mask.getAsFloat32Array();
      if (maskCanvas.width !== mw || maskCanvas.height !== mh || !maskData) {
        maskCanvas.width = mw;
        maskCanvas.height = mh;
        maskData = maskCtx.createImageData(mw, mh);
      }
      const px = maskData.data;
      for (let i = 0, j = 3; i < conf.length; i += 1, j += 4) {
        // Soft but firm edge: 0.25 → transparent, 0.75 → opaque.
        const v = (conf[i]! - 0.25) * 2;
        px[j] = v <= 0 ? 0 : v >= 1 ? 255 : (v * v * (3 - 2 * v) * 255) | 0;
      }
      maskCtx.putImageData(maskData, 0, 0);
    } finally {
      result.close();
    }

    // Background: the chosen picture (cover-fit), else the blurred room.
    const pic = bgImage && bgImage.naturalWidth > 0 ? bgImage : null;
    bgCtx.globalCompositeOperation = 'copy';
    if (pic) {
      /* drawn straight into the output at full size below */
    } else if (useFilter) {
      bgCtx.filter = 'blur(3px)';
      bgCtx.drawImage(video, 0, 0, bgCanvas.width, bgCanvas.height);
      bgCtx.filter = 'none';
    } else {
      // No canvas filter (Safari): down to a tiny picture and back up.
      tinyCtx.imageSmoothingEnabled = true;
      tinyCtx.drawImage(video, 0, 0, tinyCanvas.width, tinyCanvas.height);
      bgCtx.imageSmoothingEnabled = true;
      bgCtx.imageSmoothingQuality = 'high';
      bgCtx.drawImage(tinyCanvas, 0, 0, bgCanvas.width, bgCanvas.height);
    }

    // Person (sharp) through the mask, then the blurred frame behind it.
    outCtx.imageSmoothingEnabled = true;
    outCtx.globalCompositeOperation = 'copy';
    outCtx.drawImage(maskCanvas, 0, 0, W, H);
    outCtx.globalCompositeOperation = 'source-in';
    outCtx.drawImage(video, 0, 0, W, H);
    outCtx.globalCompositeOperation = 'destination-over';
    if (pic) {
      const iw = pic.naturalWidth;
      const ih = pic.naturalHeight;
      const scale = Math.max(W / iw, H / ih);
      const sw = W / scale;
      const sh = H / scale;
      outCtx.drawImage(pic, (iw - sw) / 2, (ih - sh) / 2, sw, sh, 0, 0, W, H);
    } else {
      outCtx.drawImage(bgCanvas, 0, 0, W, H);
    }
    outCtx.globalCompositeOperation = 'source-over';
    return performance.now() - start;
  };

  // First frame now: a broken GPU path is found before anything is sent.
  try {
    try {
      drawFrame();
    } catch (err) {
      if (forceCpu) throw err;
      console.warn('[blur] GPU segmentation failed, retrying on CPU', err);
      forceCpu = true;
      releaseSegmenter();
      segmenter = await getSegmenter();
      drawFrame();
    }
  } catch (err) {
    cleanup();
    throw err instanceof BlurError ? err : new BlurError('unsupported', String(err));
  }

  const stream = (out as HTMLCanvasElement & {
    captureStream: (fps?: number) => MediaStream;
  }).captureStream(LEVELS[0].fps);
  output = stream.getVideoTracks()[0] ?? null;
  if (!output) {
    cleanup();
    throw new BlurError('unsupported', 'captureStream gave no track');
  }
  try {
    if ('contentHint' in output) output.contentHint = 'motion';
  } catch {
    /* read-only in some browsers */
  }

  // ── the frame loop ────────────────────────────────────────────────────────
  const slow: { at: number; ms: number }[] = [];
  let switching = false;
  let lastDraw = 0;
  let generation = 0;
  let rvfcId: number | null = null;

  const fail = (code: BlurFailure) => {
    if (stopped) return;
    cleanup();
    onFail(code);
  };

  const step = (gen: number) => {
    if (stopped || gen !== generation) return;
    const now = performance.now();
    const minGap = 1000 / LEVELS[level]!.fps - 4;
    if (now - lastDraw >= minGap && video.readyState >= 2) {
      lastDraw = now;
      let ms: number;
      try {
        ms = drawFrame();
      } catch (err) {
        console.warn('[blur] frame failed', err);
        fail('failed');
        return;
      }
      // Too slow for a few seconds → lower the quality; at the bottom → give up.
      slow.push({ at: now, ms });
      while (slow.length && now - slow[0]!.at > SLOW_WINDOW_MS) slow.shift();
      const span = slow.length ? now - slow[0]!.at : 0;
      if (span > SLOW_WINDOW_MS * 0.8 && slow.length >= 5) {
        const avg = slow.reduce((sum, f) => sum + f.ms, 0) / slow.length;
        // For support: how blur performs on this computer (DevTools console).
        (window as unknown as { __lmsBlur?: unknown }).__lmsBlur = {
          msPerFrame: Math.round(avg * 10) / 10,
          level,
          size: `${out.width}x${out.height}`,
          delegate: currentDelegate,
        };
        if (avg > SLOW_FRAME_MS && currentDelegate === 'GPU' && !switching) {
          // A weak graphics chip: the WASM CPU path is often faster.
          console.info(`[blur] slow on GPU (${avg.toFixed(0)} ms/frame) → CPU`);
          switching = true;
          slow.length = 0;
          forceCpu = true;
          const old = segmenterPromise;
          segmenterPromise = null;
          getSegmenter()
            .then((cpu) => {
              void old?.then((s) => s.close()).catch(() => undefined);
              segmenter = cpu;
              switching = false;
              slow.length = 0;
            })
            .catch(() => fail('failed'));
        } else if (avg > SLOW_FRAME_MS && !switching) {
          if (level >= LEVELS.length - 1) {
            fail('slow');
            return;
          }
          level += 1;
          slow.length = 0;
          console.info(`[blur] slow (${avg.toFixed(0)} ms/frame) → level ${level}`);
        }
      }
    }
    schedule();
  };

  const schedule = () => {
    if (stopped) return;
    const gen = ++generation;
    if (rvfcId != null) video.cancelVideoFrameCallback?.(rvfcId);
    rvfcId = null;
    const frameMs = Math.round(1000 / LEVELS[level]!.fps);
    if (!document.hidden && typeof video.requestVideoFrameCallback === 'function') {
      rvfcId = video.requestVideoFrameCallback(() => step(gen));
      // Safety net: some engines skip frame callbacks for an invisible
      // video — the timer then keeps the picture moving.
      ticker.after(frameMs * 3, () => step(gen));
    } else {
      ticker.after(frameMs, () => step(gen));
    }
  };

  // Tab hidden: video frame callbacks stop, so switch to the worker timer
  // (and back when visible again).
  function onVisibility() {
    if (stopped) return;
    if (rvfcId != null) video.cancelVideoFrameCallback?.(rvfcId);
    rvfcId = null;
    schedule();
  }
  document.addEventListener('visibilitychange', onVisibility);
  schedule();

  const outTrack = output;
  return {
    input,
    output: outTrack,
    stop: cleanup,
  };
}
