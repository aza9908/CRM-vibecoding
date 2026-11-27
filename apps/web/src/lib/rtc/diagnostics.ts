'use client';

import type { RtcDiagKind } from '@lms/shared';

/**
 * Local detection of a participant's own technical problems for
 * «Помощник тренера». Everything here runs in the participant's browser and
 * only feeds `rtc:diag` reports (diff-only, see useVideoRoom).
 */

/** What a failed getUserMedia means, in «Помощник тренера» terms. */
export function mediaErrorKind(err: unknown, device: 'mic' | 'cam'): RtcDiagKind {
  const name = err instanceof Error || err instanceof DOMException ? err.name : '';
  if (name === 'NotAllowedError' || name === 'SecurityError' || name === 'PermissionDeniedError') {
    return device === 'mic' ? 'mic_denied' : 'cam_denied';
  }
  if (name === 'NotFoundError' || name === 'DevicesNotFoundError' || name === 'OverconstrainedError') {
    return device === 'mic' ? 'mic_missing' : 'cam_missing';
  }
  // NotReadableError / TrackStartError / AbortError: the device exists but
  // could not be started — almost always another app (Zoom, Teams…) has it.
  return device === 'mic' ? 'mic_busy' : 'cam_busy';
}

// ── «speaking with the mic off» ──────────────────────────────────────────────

let sharedCtx: AudioContext | null = null;

function audioContext(): AudioContext | null {
  if (sharedCtx) return sharedCtx;
  const Ctor =
    typeof window !== 'undefined'
      ? window.AudioContext ??
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
      : undefined;
  if (!Ctor) return null;
  try {
    sharedCtx = new Ctor();
  } catch {
    return null;
  }
  // Created outside a click it may start suspended: resume on the next one.
  const resume = () => {
    void sharedCtx?.resume().catch(() => undefined);
    if (sharedCtx?.state === 'running') {
      document.removeEventListener('pointerdown', resume, true);
      document.removeEventListener('keydown', resume, true);
    }
  };
  document.addEventListener('pointerdown', resume, true);
  document.addEventListener('keydown', resume, true);
  resume();
  return sharedCtx;
}

/** RMS above this (≈ −34 dBFS) counts as voice. */
const VOICE_RMS = 0.02;
const TICK_MS = 200;
/** Voiced ticks within the window that mean «talking» (≥ 3 s of 4 s). */
const WINDOW_TICKS = 20;
const TALK_TICKS = 15;
/** Quiet this long → no longer «talking». */
const QUIET_MS = 8_000;

/**
 * Listens to a CLONE of the (muted) microphone and tells when the person
 * keeps talking for more than ~3 seconds. Never unmutes anything; the clone
 * stays local and is stopped with the detector.
 */
export class MutedSpeechDetector {
  private clone: MediaStreamTrack | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private analyser: AnalyserNode | null = null;
  private timer: number | null = null;
  private ticks: boolean[] = [];
  private talking = false;
  private lastVoice = 0;
  private input: MediaStreamTrack | null = null;

  constructor(private readonly onChange: (talking: boolean) => void) {}

  /** Watch `mic` (a live track) until `stop()`. Re-calling with the same track is a no-op. */
  start(mic: MediaStreamTrack): void {
    if (this.input === mic && this.timer != null) return;
    this.stop();
    const ctx = audioContext();
    if (!ctx || mic.readyState !== 'live') return;
    try {
      this.input = mic;
      this.clone = mic.clone();
      this.clone.enabled = true;
      this.source = ctx.createMediaStreamSource(new MediaStream([this.clone]));
      this.analyser = ctx.createAnalyser();
      this.analyser.fftSize = 1024;
      this.source.connect(this.analyser);
    } catch {
      this.stop();
      return;
    }
    const buf = new Float32Array(this.analyser.fftSize);
    this.timer = window.setInterval(() => {
      const an = this.analyser;
      if (!an) return;
      an.getFloatTimeDomainData(buf);
      let sum = 0;
      for (let i = 0; i < buf.length; i += 1) sum += buf[i]! * buf[i]!;
      const voiced = Math.sqrt(sum / buf.length) > VOICE_RMS;
      const now = Date.now();
      if (voiced) this.lastVoice = now;
      this.ticks.push(voiced);
      if (this.ticks.length > WINDOW_TICKS) this.ticks.shift();
      const count = this.ticks.reduce((n, v) => n + (v ? 1 : 0), 0);
      if (!this.talking && count >= TALK_TICKS) {
        this.talking = true;
        this.onChange(true);
      } else if (this.talking && now - this.lastVoice > QUIET_MS) {
        this.talking = false;
        this.onChange(false);
      }
    }, TICK_MS);
  }

  stop(): void {
    if (this.timer != null) window.clearInterval(this.timer);
    this.timer = null;
    try {
      this.source?.disconnect();
    } catch {
      /* already gone */
    }
    this.source = null;
    this.analyser = null;
    this.clone?.stop();
    this.clone = null;
    this.input = null;
    this.ticks = [];
    if (this.talking) {
      this.talking = false;
      this.onChange(false);
    }
  }
}

// ── connection quality from getStats ────────────────────────────────────────

export interface NetSample {
  /** Packet loss 0–1 since the previous sample (null = unknown). */
  loss: number | null;
  /** Round-trip time in ms (null = unknown). */
  rtt: number | null;
}

interface Counters {
  lost: number;
  total: number;
}

/**
 * Reads one transport's stats and returns loss/RTT since the last call.
 * Works for a send transport (remote-inbound-rtp: what the server got from
 * us) and a receive transport (inbound-rtp: what we got).
 */
export class NetQuality {
  private prev = new Map<string, Counters>();

  sample(report: RTCStatsReport): NetSample {
    let rtt: number | null = null;
    let lostDelta = 0;
    let totalDelta = 0;
    let fraction: number | null = null;
    const seen = new Map<string, Counters>();
    report.forEach((s: RTCStats & Record<string, unknown>) => {
      if (s.type === 'candidate-pair') {
        const cur = s.currentRoundTripTime;
        const selected = s.nominated === true || s.selected === true;
        if (selected && s.state === 'succeeded' && typeof cur === 'number') {
          rtt = Math.max(rtt ?? 0, cur * 1000);
        }
      } else if (s.type === 'remote-inbound-rtp') {
        if (typeof s.fractionLost === 'number') {
          fraction = Math.max(fraction ?? 0, s.fractionLost);
        }
        if (typeof s.roundTripTime === 'number' && rtt == null) rtt = s.roundTripTime * 1000;
      } else if (s.type === 'inbound-rtp') {
        const lost = typeof s.packetsLost === 'number' ? s.packetsLost : 0;
        const recv = typeof s.packetsReceived === 'number' ? s.packetsReceived : 0;
        const now: Counters = { lost, total: lost + recv };
        seen.set(s.id, now);
        const before = this.prev.get(s.id);
        if (before) {
          lostDelta += Math.max(0, now.lost - before.lost);
          totalDelta += Math.max(0, now.total - before.total);
        }
      }
    });
    this.prev = seen;
    let loss: number | null = fraction;
    // Too few packets (silence, paused videos) say nothing about the network.
    if (totalDelta >= 50) loss = Math.max(loss ?? 0, lostDelta / totalDelta);
    return { loss, rtt };
  }

  reset(): void {
    this.prev.clear();
  }
}
