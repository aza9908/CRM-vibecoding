'use client';

import { useQuery } from '@tanstack/react-query';
import {
  ANALYSIS_AUDIO_PIECE_MAX_BYTES,
  type LessonAnalysis,
} from '@lms/shared';
import { api, ApiError } from '@/lib/api/client';

/**
 * «ИИ-разбор урока» — client side.
 *
 * While a lesson is being recorded, the recorder feeds a low-bitrate
 * audio-only stream into an {@link AnalysisAudioSink}; the sink sends it to
 * the API in small ordered pieces (so no request is large and a crash loses
 * at most the last piece). When recording stops, `finish()` asks the server
 * to transcribe the audio and write the review.
 */

export interface AnalysisAudioSink {
  write(blob: Blob): void;
  finish(): Promise<{ analysisId: string } | null>;
}

/** Send what has gathered every 20 s, or sooner once it reaches 512 KB. */
const FLUSH_MS = 20_000;
const FLUSH_BYTES = 512 * 1024;
/** One request stays under the server's per-piece limit. */
const PIECE_BYTES = Math.min(768 * 1024, ANALYSIS_AUDIO_PIECE_MAX_BYTES - 16 * 1024);
/** After «stop», how long to keep retrying a dead network before giving up. */
const FINISH_PATIENCE_MS = 90_000;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function newRecordingId(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(12)), (b) =>
    b.toString(16).padStart(2, '0'),
  ).join('');
}

/**
 * Buffers pieces and uploads them in order (batch every ~20 s or 512 KB),
 * retrying through network drops; `finish()` flushes and asks the server to
 * start the analysis. Never throws.
 */
export function createAnalysisAudioSink(opts: {
  sessionId: string;
  title: string;
  mimeType: string;
  locale: string;
}): AnalysisAudioSink {
  const recordingId = newRecordingId();
  const startedAt = Date.now();
  const base = `/sessions/${opts.sessionId}/analysis`;

  let pending: Blob[] = [];
  let pendingBytes = 0;
  /** Number of the next piece to send. */
  let seq = 0;
  let sentAny = false;
  /** Set when the server refuses this recording for good (4xx). */
  let dead = false;
  /** While set, uploads give up once this moment passes. */
  let deadline: number | null = null;
  let chain: Promise<void> = Promise.resolve();
  let timer: ReturnType<typeof setTimeout> | null = null;

  /** Upload one piece, retrying until it is stored, refused, or out of time. */
  const sendPiece = async (piece: Blob, n: number): Promise<void> => {
    for (let attempt = 0; !dead; attempt++) {
      if (deadline != null && Date.now() > deadline) {
        dead = true;
        return;
      }
      try {
        const form = new FormData();
        form.append('recordingId', recordingId);
        form.append('seq', String(n));
        form.append('file', piece, `piece-${n}.bin`);
        await api.post(`${base}/audio`, form);
        sentAny = true;
        return;
      } catch (err) {
        if (err instanceof ApiError && err.status >= 400 && err.status < 500) {
          // 409 «gap» with the server already past this piece = it has it.
          const next = (err.body as { nextSeq?: number } | undefined)?.nextSeq;
          if (err.status === 409 && typeof next === 'number' && next > n) {
            sentAny = true;
            return;
          }
          if (err.status !== 408 && err.status !== 429) {
            dead = true;
            return;
          }
        }
        // Network drop or server hiccup: wait and try the same piece again.
        await sleep(Math.min(15_000, 1_500 * (attempt + 1)));
      }
    }
  };

  const flush = (): void => {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    if (dead || pendingBytes === 0) return;
    const batch = new Blob(pending);
    pending = [];
    pendingBytes = 0;
    for (let pos = 0; pos < batch.size; pos += PIECE_BYTES) {
      const piece = batch.slice(pos, pos + PIECE_BYTES);
      const n = seq++;
      chain = chain.then(() => sendPiece(piece, n)).catch(() => undefined);
    }
  };

  return {
    write(blob) {
      if (dead || !blob || blob.size === 0) return;
      pending.push(blob);
      pendingBytes += blob.size;
      if (pendingBytes >= FLUSH_BYTES) flush();
      else if (!timer) timer = setTimeout(flush, FLUSH_MS);
    },
    async finish() {
      try {
        deadline = Date.now() + FINISH_PATIENCE_MS;
        flush();
        await chain;
        if (dead || !sentAny) return null;
        for (let attempt = 0; Date.now() < deadline; attempt++) {
          try {
            const res = await api.post<LessonAnalysis>(`${base}/finish`, {
              recordingId,
              title: opts.title.trim().slice(0, 200) || 'Урок',
              locale: opts.locale,
              mimeType: opts.mimeType,
              durationSec: Math.max(0, Math.round((Date.now() - startedAt) / 1000)),
            });
            return res?.id ? { analysisId: res.id } : null;
          } catch (err) {
            if (err instanceof ApiError && err.status >= 400 && err.status < 500) return null;
            await sleep(Math.min(10_000, 1_500 * (attempt + 1)));
          }
        }
        return null;
      } catch {
        return null;
      }
    },
  };
}

// ── reading analyses ─────────────────────────────────────────────────────────

const isRunning = (a: LessonAnalysis | null | undefined) =>
  !!a && (a.status === 'queued' || a.status === 'processing');

/**
 * Latest analysis of a session (null when there is none). Polls every 5 s
 * while one is running, and slowly otherwise so a recording that has just
 * been stopped shows up by itself.
 */
export function useLatestAnalysis(sessionId: string | undefined) {
  return useQuery({
    queryKey: ['sessions', sessionId, 'analysis'],
    queryFn: async () =>
      (await api.get<{ analysis: LessonAnalysis | null }>(`/sessions/${sessionId}/analysis`))
        .analysis,
    enabled: !!sessionId,
    refetchInterval: (query) => (isRunning(query.state.data) ? 5_000 : 20_000),
    staleTime: 2_000,
    retry: 1,
  });
}

/** Every analysis of a lesson, newest first (transcripts omitted). */
export function useLessonAnalyses(lessonId: string | undefined) {
  return useQuery({
    queryKey: ['lessons', lessonId, 'analyses'],
    queryFn: () => api.get<LessonAnalysis[]>(`/lessons/${lessonId}/analyses`),
    enabled: !!lessonId,
    refetchInterval: (query) => ((query.state.data ?? []).some(isRunning) ? 5_000 : false),
    staleTime: 5_000,
    retry: 1,
  });
}
