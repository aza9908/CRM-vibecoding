'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { io, type Socket } from 'socket.io-client';
import { Device, type types as msc } from 'mediasoup-client';
import {
  WS_EVENTS,
  type ClientToServerEvents,
  type RtcJoinAck,
  type RtcMediaState,
  type RtcModerateAction,
  type RtcPeer,
  type RtcProducerInfo,
  type RtcReactionEmoji,
  type RtcReactionRelay,
  type RtcSource,
  type ServerToClientEvents,
  type RtcDiagKind,
  RTC_DIAG_LIMIT,
  RTC_REACTION_LIMIT,
} from '@lms/shared';
import { LIVE_SOCKET_TRANSPORTS, resolveLiveSocket } from '@/lib/ws/url';
import {
  BlurError,
  blurSupported,
  readBlurPref,
  startBackgroundBlur,
  writeBlurPref,
  type BlurFailure,
  type BlurPipeline,
} from './backgroundBlur';
import { MutedSpeechDetector, NetQuality, mediaErrorKind } from './diagnostics';

/**
 * Video room for a live session — our own meeting room inside the LMS.
 *
 * Topology: SFU. Everyone sends each track once to the media server inside
 * the API (mediasoup) and receives the others' tracks from it, so a class of
 * 50+ costs the teacher one upload. Signaling rides the existing Socket.IO
 * `/live` namespace.
 *
 * Resilience rules:
 *  - a socket drop or a media-server restart never "kicks" anyone: the hook
 *    goes to `reconnecting`, keeps the local mic/camera tracks alive and
 *    re-joins by itself;
 *  - a flaky network path triggers an ICE restart before a full re-join;
 *  - the call ends only on `rtc:call-ended` (host ended it / session ended).
 */

type LiveSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

export type VideoRoomStatus =
  | 'idle'
  | 'joining'
  | 'joined'
  | 'reconnecting'
  | 'error';

export interface RemotePeer extends RtcPeer {
  /** Camera video + microphone audio as received. */
  camera: MediaStream | null;
  /** Screen-share video (+ tab audio) as received. */
  screen: MediaStream | null;
}

export interface UseVideoRoomResult {
  status: VideoRoomStatus;
  error: string | null;
  selfId: string | null;
  role: RtcPeer['role'] | null;
  peers: RemotePeer[];
  media: RtcMediaState;
  localCamera: MediaStream | null;
  localScreen: MediaStream | null;
  /** Peer ids (mine included) heard right now, loudest first. */
  speaking: string[];
  /** The person who "has the floor" — sticky, to avoid flicker. */
  dominantId: string | null;
  join: (opts?: { audio?: boolean; video?: boolean }) => Promise<void>;
  leave: () => void;
  /** Host: end the call for everyone. */
  endCall: () => void;
  /** Host: tell everyone the call is (not) being recorded. */
  setRecording: (on: boolean) => void;
  toggleAudio: () => Promise<void>;
  toggleVideo: () => Promise<void>;
  toggleScreen: () => Promise<void>;
  toggleHand: () => void;
  moderate: (target: string, action: RtcModerateAction) => void;
  /** Tell the server whose camera is on the main stage (gets best quality). */
  setStage: (peerId: string | null) => void;
  /** Last moderation applied to me (for a toast). */
  moderatedAt: { action: RtcModerateAction; at: number } | null;
  /** Set when the host ended the call while I was in it (for a toast). */
  endedAt: number | null;
  /** Last screen-share failure worth telling the user about (for a toast).
   * A cancelled picker is not reported. */
  screenError: { code: ScreenShareError; at: number } | null;
  /** Send a quick emoji reaction to everyone in the call (throttled). */
  sendReaction: (emoji: RtcReactionEmoji) => void;
  /** Listen to reactions in the call (mine included); returns unsubscribe.
   * A listener instead of state, so a burst of reactions does not re-render
   * the whole room. */
  subscribeReactions: (cb: (r: RtcReactionRelay) => void) => () => void;
  /** «Размыть фон» for my camera. */
  blur: {
    /** The browser can do it (false after the segmenter failed to start). */
    supported: boolean;
    /** The remembered choice (applies whenever the camera is on). */
    on: boolean;
    /** The blurred picture is what is being sent right now. */
    active: boolean;
    /** Starting (loading the model / first frame). */
    busy: boolean;
  };
  setBlur: (on: boolean) => void;
  /** Blur stopped by itself (too slow / failed / unsupported) — for a toast. */
  blurError: { code: BlurFailure; at: number } | null;
  /** «Помощник тренера»: report / clear one of my problems (e.g. autoplay). */
  reportDiag: (kind: RtcDiagKind, on: boolean, detail?: string) => void;
  /** A hint for me: from a teacher (`from` = name) or local (`from` = null). */
  diagHint: { kind: RtcDiagKind; from: string | null; at: number } | null;
}

/**
 * Why screen sharing did not start:
 *  - `unsupported` — the browser has no getDisplayMedia (phones, old browsers);
 *  - `os_denied_mac` — macOS blocks screen recording for the browser;
 *  - `denied` — refused by the system / a policy before any picker appeared;
 *  - `failed` — capture or sending failed for another reason.
 */
export type ScreenShareError = 'unsupported' | 'os_denied_mac' | 'denied' | 'failed';

/** Can this browser share a screen at all? Feature detection, no UA sniffing. */
export function screenShareSupported(): boolean {
  return (
    typeof navigator !== 'undefined' &&
    !!navigator.mediaDevices &&
    typeof navigator.mediaDevices.getDisplayMedia === 'function'
  );
}

function isMac(): boolean {
  if (typeof navigator === 'undefined') return false;
  const uaData = (navigator as Navigator & { userAgentData?: { platform?: string } })
    .userAgentData;
  return /mac/i.test(uaData?.platform ?? navigator.platform ?? '');
}

/** The user closed the picker / pressed «Cancel» — not an error to show. */
class ScreenShareCancelled extends Error {}

class ScreenShareFailed extends Error {
  constructor(readonly code: ScreenShareError) {
    super(code);
  }
}

/**
 * Ask for a screen with the most widely supported options first and fall
 * back step by step: {video, audio} → {video} . Chromium-only extras
 * (frame rate, size, content hint) are applied to the track afterwards, so
 * they can never make the capture itself fail in Yandex / Edge / Firefox /
 * Safari.
 */
async function captureScreen(): Promise<MediaStream> {
  if (!screenShareSupported()) throw new ScreenShareFailed('unsupported');
  const md = navigator.mediaDevices;
  // Tab/system audio exists only in Chromium browsers (Chrome, Edge, Yandex,
  // Opera…). Safari and Firefox get the plain request first: after a refusal
  // Safari no longer counts a second request as coming from the click.
  const ua = navigator.userAgent;
  const chromium = /Chrome\/|Chromium\/|Edg\/|YaBrowser\/|OPR\//.test(ua) && !/Firefox\//.test(ua);
  const attempts: DisplayMediaStreamOptions[] = chromium
    ? [{ video: true, audio: true }, { video: true }]
    : [{ video: true }];
  let lastErr: unknown = null;
  for (const options of attempts) {
    const startedAt = performance.now();
    try {
      return await md.getDisplayMedia(options);
    } catch (err) {
      lastErr = err;
      const name = err instanceof Error ? err.name : '';
      const message = err instanceof Error ? err.message : '';
      if (name === 'NotAllowedError') {
        // Chromium on macOS without the OS permission: «Permission denied by
        // system», returned at once (no picker). A real cancel takes longer.
        const bySystem = /system/i.test(message);
        const immediate = performance.now() - startedAt < 250;
        if (bySystem || immediate) {
          throw new ScreenShareFailed(isMac() ? 'os_denied_mac' : 'denied');
        }
        throw new ScreenShareCancelled();
      }
      if (name === 'InvalidStateError' || name === 'SecurityError') break;
      // TypeError / NotSupportedError / OverconstrainedError / NotReadableError
      // (often the audio part) / NotFoundError / AbortError («Error starting
      // screen capture» in Chromium) → try the plainer request.
    }
  }
  console.warn('[video] screen capture failed', lastErr);
  const name = lastErr instanceof Error ? lastErr.name : '';
  if (name === 'NotReadableError' && isMac()) throw new ScreenShareFailed('os_denied_mac');
  if (name === 'SecurityError') throw new ScreenShareFailed('denied');
  throw new ScreenShareFailed('failed');
}

/** Best-effort tuning of a captured screen track; never throws. */
async function tuneScreenTrack(track: MediaStreamTrack): Promise<void> {
  try {
    if ('contentHint' in track) track.contentHint = 'detail';
  } catch {
    /* read-only in some browsers */
  }
  try {
    // Captured at up to 30 fps for the recording; sent to viewers at 15.
    await track.applyConstraints({
      frameRate: { max: 30 },
      width: { max: 1920 },
      height: { max: 1080 },
    });
  } catch {
    /* not supported here — keep the native capture */
  }
}

const NO_MEDIA: RtcMediaState = {
  audio: false,
  video: false,
  screen: false,
  hand: false,
  cameraStreamId: null,
  screenStreamId: null,
};

/** How many remote cameras are received at once (others stay as avatars). */
const MAX_REMOTE_VIDEOS =
  typeof window !== 'undefined' && window.innerWidth < 640 ? 6 : 16;

const CAMERA_ENCODINGS: RTCRtpEncodingParameters[] = [
  { rid: 'q', scaleResolutionDownBy: 4, maxBitrate: 110_000, maxFramerate: 15 },
  { rid: 'h', scaleResolutionDownBy: 2, maxBitrate: 320_000, maxFramerate: 24 },
  { rid: 'f', scaleResolutionDownBy: 1, maxBitrate: 950_000, maxFramerate: 24 },
];
const SCREEN_ENCODINGS: RTCRtpEncodingParameters[] = [
  { maxBitrate: 2_000_000, maxFramerate: 15 },
];

/** Screen-share failures as «Помощник тренера» problems (one-off: they
 * clear by themselves after a while or on a successful share). */
const SCREEN_DIAG: Record<ScreenShareError, RtcDiagKind> = {
  unsupported: 'screen_unsupported',
  os_denied_mac: 'screen_os_denied',
  denied: 'screen_denied',
  failed: 'screen_failed',
};
const SCREEN_DIAG_TTL_MS = 2 * 60_000;
/** Connection checks (getStats) every this often while in the call. */
const NET_CHECK_MS = 4_000;
/** Bad / good checks in a row before reporting / clearing «poor network». */
const NET_BAD_CHECKS = 3;
const NET_LOSS_BAD = 0.1;
const NET_RTT_BAD_MS = 600;

// ── reload survival ─────────────────────────────────────────────────────────

interface CallResume {
  callId: string | null;
  audio: boolean;
  video: boolean;
}

const resumeKey = (sessionId: string) => `airl-call:${sessionId}`;

/** What I had on before a reload (same tab), if I was in this call. */
export function readCallResume(sessionId: string | undefined): CallResume | null {
  if (!sessionId || typeof window === 'undefined') return null;
  try {
    const raw = window.sessionStorage.getItem(resumeKey(sessionId));
    return raw ? (JSON.parse(raw) as CallResume) : null;
  } catch {
    return null;
  }
}

function writeCallResume(sessionId: string | undefined, value: CallResume | null): void {
  if (!sessionId || typeof window === 'undefined') return;
  try {
    if (value) window.sessionStorage.setItem(resumeKey(sessionId), JSON.stringify(value));
    else window.sessionStorage.removeItem(resumeKey(sessionId));
  } catch {
    /* private mode — reload survival is best-effort */
  }
}

/** Random id of this tab, stable across reloads and reconnects. */
function tabClientId(): string {
  const make = () =>
    Array.from(crypto.getRandomValues(new Uint8Array(12)), (b) =>
      b.toString(16).padStart(2, '0'),
    ).join('');
  try {
    const key = 'airl-rtc-client';
    const existing = window.sessionStorage.getItem(key);
    if (existing) return existing;
    const id = make();
    window.sessionStorage.setItem(key, id);
    return id;
  } catch {
    return make();
  }
}

interface ConsumerEntry {
  consumer: msc.Consumer;
  info: RtcProducerInfo;
  /** Paused by the "max remote videos" policy. */
  parked: boolean;
}

export function useVideoRoom(
  sessionId: string | undefined,
  token: string | null | undefined,
): UseVideoRoomResult {
  const [status, setStatus] = useState<VideoRoomStatus>('idle');
  const [error, setError] = useState<string | null>(null);
  const [selfId, setSelfId] = useState<string | null>(null);
  const [role, setRole] = useState<RtcPeer['role'] | null>(null);
  const [peers, setPeers] = useState<RemotePeer[]>([]);
  const [media, setMedia] = useState<RtcMediaState>(NO_MEDIA);
  const [localCamera, setLocalCamera] = useState<MediaStream | null>(null);
  const [localScreen, setLocalScreen] = useState<MediaStream | null>(null);
  const [speaking, setSpeaking] = useState<string[]>([]);
  const [dominantId, setDominantId] = useState<string | null>(null);
  const [moderatedAt, setModeratedAt] =
    useState<UseVideoRoomResult['moderatedAt']>(null);
  const [endedAt, setEndedAt] = useState<number | null>(null);
  const [screenError, setScreenError] =
    useState<UseVideoRoomResult['screenError']>(null);
  const [blurOn, setBlurOn] = useState(false);
  const [blurActive, setBlurActive] = useState(false);
  const [blurBusy, setBlurBusy] = useState(false);
  const [blurOk, setBlurOk] = useState(true);
  const [blurError, setBlurError] = useState<UseVideoRoomResult['blurError']>(null);
  const [diagHint, setDiagHint] = useState<UseVideoRoomResult['diagHint']>(null);
  const reactionListenersRef = useRef(new Set<(r: RtcReactionRelay) => void>());
  const reactionTimesRef = useRef<number[]>([]);

  const socketRef = useRef<LiveSocket | null>(null);
  const deviceRef = useRef<msc.Device | null>(null);
  const sendRef = useRef<msc.Transport | null>(null);
  const recvRef = useRef<msc.Transport | null>(null);
  const producersRef = useRef(new Map<RtcSource, msc.Producer>());
  /** producerId → consumer */
  const consumersRef = useRef(new Map<string, ConsumerEntry>());
  /** producerId → info, for everything published in the room (not by me). */
  const knownRef = useRef(new Map<string, RtcProducerInfo>());
  const consumingRef = useRef(new Set<string>());
  const tracksRef = useRef<Partial<Record<RtcSource, MediaStreamTrack>>>({});
  const selfIdRef = useRef<string | null>(null);
  const mediaRef = useRef<RtcMediaState>(NO_MEDIA);
  const callIdRef = useRef<string | null>(null);
  const stageRef = useRef<string | null>(null);
  const lastSpokeRef = useRef(new Map<string, number>());
  const peersRef = useRef<RemotePeer[]>([]);
  peersRef.current = peers;
  const tokenRef = useRef(token);
  tokenRef.current = token;
  const sessionIdRef = useRef(sessionId);
  sessionIdRef.current = sessionId;
  const wantJoinedRef = useRef(false);
  const everJoinedRef = useRef(false);
  const joinSeqRef = useRef(0);
  /** Running blur pipeline (input = the raw camera in tracksRef). */
  const blurRef = useRef<BlurPipeline | null>(null);
  const blurWantRef = useRef(false);
  const blurOkRef = useRef(true);
  const blurQueueRef = useRef<Promise<void>>(Promise.resolve());
  /** Late-bound `syncBlur` for callbacks declared before it. */
  const syncBlurRef = useRef<() => Promise<void>>(async () => undefined);
  /** «Помощник тренера»: my open problems (kind → detail). */
  const diagOpenRef = useRef(new Map<RtcDiagKind, string | undefined>());
  const diagTimersRef = useRef(new Map<RtcDiagKind, number>());

  // Remembered blur choice; feature check only in the browser.
  useEffect(() => {
    const ok = blurSupported();
    blurOkRef.current = ok;
    setBlurOk(ok);
    const want = ok && readBlurPref();
    blurWantRef.current = want;
    setBlurOn(want);
  }, []);

  // ── small helpers ────────────────────────────────────────────────────────

  /** Emit with an ack and a timeout — never hangs forever. */
  const request = useCallback(
    <T extends { ok: boolean; error?: string }>(
      event: string,
      payload: unknown,
      timeoutMs = 10_000,
    ): Promise<T> =>
      new Promise<T>((resolve, reject) => {
        const socket = socketRef.current;
        if (!socket?.connected) {
          reject(new Error('offline'));
          return;
        }
        const timer = window.setTimeout(() => reject(new Error('timeout')), timeoutMs);
        (socket as unknown as Socket).emit(event, payload, (res: T) => {
          window.clearTimeout(timer);
          if (res?.ok) resolve(res);
          else reject(new Error(res?.error ?? 'failed'));
        });
      }),
    [],
  );

  /** What actually goes out for a raw camera track: the blurred copy when
   * blur runs on exactly this track, else the track itself. */
  const sendTrackFor = useCallback((raw: MediaStreamTrack): MediaStreamTrack => {
    const b = blurRef.current;
    return b && b.input === raw && b.output.readyState === 'live' ? b.output : raw;
  }, []);

  // ── «Помощник тренера»: my own problems, reported diff-only ─────────────
  const diagSentRef = useRef<number[]>([]);
  const diagResyncRef = useRef<number | null>(null);
  const syncDiagRef = useRef<() => void>(() => undefined);
  const emitDiag = useCallback(
    (payload: { kind: RtcDiagKind; resolved?: boolean; detail?: string }) => {
      const sid = sessionIdRef.current;
      const socket = socketRef.current;
      // Offline / not in the room yet: the full sync after (re)join covers it.
      if (!sid || !socket?.connected || !selfIdRef.current) return;
      // Stay under the server's limit (it drops extras silently): when a
      // burst would exceed it, send one full sync a little later instead.
      const now = Date.now();
      const recent = diagSentRef.current.filter((at) => now - at < RTC_DIAG_LIMIT.windowMs);
      if (recent.length >= RTC_DIAG_LIMIT.max - 2) {
        diagSentRef.current = recent;
        if (diagResyncRef.current == null) {
          diagResyncRef.current = window.setTimeout(() => {
            diagResyncRef.current = null;
            syncDiagRef.current();
          }, RTC_DIAG_LIMIT.windowMs);
        }
        return;
      }
      recent.push(now);
      diagSentRef.current = recent;
      socket.emit(WS_EVENTS.rtcDiag, { sessionId: sid, ...payload });
    },
    [],
  );

  const syncDiag = useCallback(() => {
    const sid = sessionIdRef.current;
    const socket = socketRef.current;
    if (!sid || !socket?.connected || !selfIdRef.current) return;
    diagSentRef.current.push(Date.now());
    socket.emit(WS_EVENTS.rtcDiag, {
      sessionId: sid,
      open: [...diagOpenRef.current].map(([kind, detail]) =>
        detail ? { kind, detail } : { kind },
      ),
    });
  }, []);

  syncDiagRef.current = syncDiag;

  /** Open (`on`) or resolve a problem. `ttlMs`: resolve by itself later
   * (one-off failures like a refused screen share). */
  const setDiag = useCallback(
    (kind: RtcDiagKind, on: boolean, detail?: string, ttlMs?: number) => {
      const open = diagOpenRef.current;
      const timers = diagTimersRef.current;
      const old = timers.get(kind);
      if (old) {
        window.clearTimeout(old);
        timers.delete(kind);
      }
      if (on) {
        if (ttlMs) {
          timers.set(
            kind,
            window.setTimeout(() => {
              timers.delete(kind);
              if (open.delete(kind)) emitDiag({ kind, resolved: true });
            }, ttlMs),
          );
        }
        if (open.has(kind)) return; // already reported (details may drift)
        open.set(kind, detail);
        emitDiag(detail ? { kind, detail } : { kind });
      } else if (open.delete(kind)) {
        emitDiag({ kind, resolved: true });
      }
    },
    [emitDiag],
  );

  const resetDiag = useCallback(() => {
    if (diagResyncRef.current != null) window.clearTimeout(diagResyncRef.current);
    diagResyncRef.current = null;
    for (const t of diagTimersRef.current.values()) window.clearTimeout(t);
    diagTimersRef.current.clear();
    diagOpenRef.current.clear();
  }, []);

  const saveResume = useCallback(() => {
    const m = mediaRef.current;
    writeCallResume(sessionIdRef.current, {
      callId: callIdRef.current,
      audio: m.audio,
      video: m.video,
    });
  }, []);

  const publishState = useCallback(
    (next: RtcMediaState) => {
      mediaRef.current = next;
      setMedia(next);
      const sid = sessionIdRef.current;
      if (sid && socketRef.current?.connected && selfIdRef.current) {
        socketRef.current.emit(WS_EVENTS.rtcState, { sessionId: sid, media: next });
      }
      if (wantJoinedRef.current) saveResume();
    },
    [saveResume],
  );

  /** Rebuild one peer's MediaStreams from its live consumers. */
  const rebuildStreams = useCallback((peerId: string) => {
    const cam: MediaStreamTrack[] = [];
    const scr: MediaStreamTrack[] = [];
    for (const { consumer, info, parked } of consumersRef.current.values()) {
      if (info.peerId !== peerId || parked || consumer.closed) continue;
      if (info.source === 'mic' || info.source === 'camera') cam.push(consumer.track);
      else scr.push(consumer.track);
    }
    setPeers((prev) =>
      prev.map((p) =>
        p.peerId === peerId
          ? {
              ...p,
              camera: cam.length ? new MediaStream(cam) : null,
              screen: scr.length ? new MediaStream(scr) : null,
            }
          : p,
      ),
    );
  }, []);

  const setLayer = useCallback((producerId: string, spatialLayer: number) => {
    const entry = consumersRef.current.get(producerId);
    if (!entry || entry.consumer.kind !== 'video') return;
    socketRef.current?.emit(WS_EVENTS.rtcConsumerLayers, {
      consumerId: entry.consumer.id,
      spatialLayer,
    });
  }, []);

  const consume = useCallback(
    async (info: RtcProducerInfo) => {
      const recv = recvRef.current;
      const device = deviceRef.current;
      if (!recv || !device) return;
      if (consumersRef.current.has(info.producerId)) return;
      if (consumingRef.current.has(info.producerId)) return;
      consumingRef.current.add(info.producerId);
      try {
        const res = await request<{ ok: boolean; params?: unknown }>(
          WS_EVENTS.rtcConsume,
          { producerId: info.producerId, rtpCapabilities: device.rtpCapabilities },
        );
        if (recvRef.current !== recv || !knownRef.current.has(info.producerId)) return;
        const consumer = await recv.consume(
          res.params as Parameters<msc.Transport['consume']>[0],
        );
        consumersRef.current.set(info.producerId, { consumer, info, parked: false });
        consumer.on('transportclose', () => consumersRef.current.delete(info.producerId));
        await request(WS_EVENTS.rtcConsumerPause, {
          consumerId: consumer.id,
          paused: false,
        }).catch(() => undefined);
        if (info.source === 'screen') setLayer(info.producerId, 2);
        else if (info.source === 'camera' && stageRef.current === info.peerId) {
          setLayer(info.producerId, 2);
        }
        rebuildStreams(info.peerId);
      } catch (err) {
        console.warn('[video] consume failed', info.source, err);
      } finally {
        consumingRef.current.delete(info.producerId);
      }
    },
    [rebuildStreams, request, setLayer],
  );

  /**
   * Decide what to receive: every audio and screen track, plus cameras for
   * the stage, hosts, recent speakers, then the rest — up to a cap, so 50
   * cameras do not melt a phone. Parked cameras show as avatars.
   */
  const syncTimer = useRef<number | null>(null);
  const syncConsumers = useCallback(() => {
    if (syncTimer.current) window.clearTimeout(syncTimer.current);
    syncTimer.current = window.setTimeout(() => {
      syncTimer.current = null;
      const cams: RtcProducerInfo[] = [];
      for (const info of knownRef.current.values()) {
        if (info.source === 'camera') cams.push(info);
        else void consume(info);
      }
      const hostIds = new Set(
        peersRef.current.filter((p) => p.role === 'host').map((p) => p.peerId),
      );
      const rank = (i: RtcProducerInfo) =>
        (i.peerId === stageRef.current ? 4e15 : 0) +
        (hostIds.has(i.peerId) ? 2e15 : 0) +
        (lastSpokeRef.current.get(i.peerId) ?? 0);
      cams.sort((a, b) => rank(b) - rank(a));
      cams.forEach((info, index) => {
        const wanted = index < MAX_REMOTE_VIDEOS;
        const entry = consumersRef.current.get(info.producerId);
        if (!entry) {
          if (wanted) void consume(info);
          return;
        }
        if (entry.parked === !wanted) return;
        entry.parked = !wanted;
        socketRef.current?.emit(WS_EVENTS.rtcConsumerPause, {
          consumerId: entry.consumer.id,
          paused: !wanted,
        });
        rebuildStreams(info.peerId);
      });
    }, 120);
  }, [consume, rebuildStreams]);

  // ── transports ───────────────────────────────────────────────────────────

  const rejoinRef = useRef<() => void>(() => undefined);

  const watchTransport = useCallback(
    (transport: msc.Transport) => {
      let timer: number | null = null;
      const restart = async () => {
        if (transport.closed) return;
        try {
          const res = await request<{ ok: boolean; iceParameters?: unknown }>(
            WS_EVENTS.rtcTransportRestartIce,
            { transportId: transport.id },
          );
          await transport.restartIce({
            iceParameters: res.iceParameters as msc.IceParameters,
          });
        } catch {
          /* fall through to the watchdog below */
        }
      };
      transport.on('connectionstatechange', (state) => {
        if (timer) {
          window.clearTimeout(timer);
          timer = null;
        }
        if (state === 'connected') setDiag('ice_failed', false);
        if (state === 'connected' || state === 'closed') return;
        if (state === 'failed') {
          setDiag('ice_failed', true);
          void restart();
        }
        if (state === 'disconnected' || state === 'failed') {
          // A short blip heals by itself; otherwise restart ICE, and if the
          // path is still dead after that, rebuild the whole connection.
          timer = window.setTimeout(() => {
            if (transport.closed || transport.connectionState === 'connected') return;
            void restart();
            timer = window.setTimeout(() => {
              if (transport.closed || transport.connectionState === 'connected') return;
              rejoinRef.current();
            }, 8_000);
          }, 2_500);
        }
      });
    },
    [request, setDiag],
  );

  const createTransport = useCallback(
    async (direction: 'send' | 'recv'): Promise<msc.Transport> => {
      const device = deviceRef.current;
      if (!device) throw new Error('no_device');
      const res = await request<{ ok: boolean; params?: unknown }>(
        WS_EVENTS.rtcTransportCreate,
        { direction },
      );
      const params = res.params as msc.TransportOptions;
      const transport =
        direction === 'send'
          ? device.createSendTransport(params)
          : device.createRecvTransport(params);
      transport.on('connect', ({ dtlsParameters }, done, fail) => {
        request(WS_EVENTS.rtcTransportConnect, {
          transportId: transport.id,
          dtlsParameters,
        })
          .then(() => done())
          .catch((e: Error) => fail(e));
      });
      if (direction === 'send') {
        transport.on('produce', ({ kind, rtpParameters, appData }, done, fail) => {
          request<{ ok: boolean; producerId?: string }>(WS_EVENTS.rtcProduce, {
            transportId: transport.id,
            kind,
            rtpParameters,
            source: (appData as { source: RtcSource }).source,
          })
            .then((r) => done({ id: r.producerId! }))
            .catch((e: Error) => fail(e));
        });
      }
      watchTransport(transport);
      return transport;
    },
    [request, watchTransport],
  );

  /** Send a local track to the room (replacing a previous one of its kind). */
  const publish = useCallback(
    async (source: RtcSource, track: MediaStreamTrack) => {
      tracksRef.current[source] = track;
      const device = deviceRef.current;
      if (!device || !selfIdRef.current) return; // sent on (re)join
      // The camera may go out blurred; tracksRef keeps the raw track.
      const out = source === 'camera' ? sendTrackFor(track) : track;
      const old = producersRef.current.get(source);
      if (old && !old.closed) {
        await old.replaceTrack({ track: out });
        if (old.paused) {
          old.resume();
          socketRef.current?.emit(WS_EVENTS.rtcProducerPause, {
            producerId: old.id,
            paused: false,
          });
        }
        return;
      }
      if (!sendRef.current || sendRef.current.closed) {
        sendRef.current = await createTransport('send');
      }
      const transport = sendRef.current;
      const video = track.kind === 'video';
      let producer: msc.Producer;
      if (!video) {
        producer = await transport.produce({
          track: out,
          stopTracks: false,
          appData: { source },
          codecOptions: { opusDtx: true, opusFec: true, opusStereo: false },
        });
      } else {
        // Preferred settings first (simulcast for cameras, a capped single
        // layer for screens). Some Chromium forks / older engines reject
        // simulcast, maxFramerate or codec options — then fall back to one
        // plain encoding, and finally to the browser's defaults.
        const variants: Omit<msc.ProducerOptions, 'track'>[] = [
          {
            encodings: source === 'screen' ? SCREEN_ENCODINGS : CAMERA_ENCODINGS,
            codecOptions: { videoGoogleStartBitrate: 800 },
          },
          {
            encodings: [{ maxBitrate: source === 'screen' ? 1_500_000 : 800_000 }],
          },
          {},
        ];
        let lastErr: unknown = null;
        let made: msc.Producer | null = null;
        for (const variant of variants) {
          if (transport.closed || out.readyState !== 'live') break;
          try {
            made = await transport.produce({
              track: out,
              stopTracks: false,
              appData: { source },
              ...variant,
            });
            break;
          } catch (err) {
            lastErr = err;
            console.warn(`[video] produce ${source} failed, trying simpler settings`, err);
          }
        }
        if (!made) throw lastErr ?? new Error('produce_failed');
        producer = made;
      }
      producersRef.current.set(source, producer);
      producer.on('transportclose', () => {
        if (producersRef.current.get(source) === producer) {
          producersRef.current.delete(source);
        }
      });
    },
    [createTransport, sendTrackFor],
  );

  const unpublish = useCallback((source: RtcSource) => {
    delete tracksRef.current[source];
    const producer = producersRef.current.get(source);
    if (!producer) return;
    producersRef.current.delete(source);
    if (!producer.closed) producer.close();
    socketRef.current?.emit(WS_EVENTS.rtcProducerClose, { producerId: producer.id });
  }, []);

  /** Drop every server-side object; local tracks stay alive for a re-join. */
  const teardown = useCallback(() => {
    if (syncTimer.current) window.clearTimeout(syncTimer.current);
    sendRef.current?.close();
    recvRef.current?.close();
    sendRef.current = null;
    recvRef.current = null;
    producersRef.current.clear();
    consumersRef.current.clear();
    consumingRef.current.clear();
    knownRef.current.clear();
    deviceRef.current = null;
  }, []);

  const stopLocal = useCallback(() => {
    const blur = blurRef.current;
    blurRef.current = null;
    blur?.stop();
    setBlurActive(false);
    for (const track of Object.values(tracksRef.current)) track?.stop();
    tracksRef.current = {};
    setLocalCamera(null);
    setLocalScreen(null);
  }, []);

  // ── join / socket lifecycle ──────────────────────────────────────────────

  const doJoin = useCallback(() => {
    const socket = socketRef.current;
    const sid = sessionIdRef.current;
    if (!socket || !sid) return;
    const seq = ++joinSeqRef.current;
    setStatus(everJoinedRef.current ? 'reconnecting' : 'joining');
    teardown();
    selfIdRef.current = null;
    // Never spin forever: if the server does not answer, retry / say so.
    const timer = window.setTimeout(() => {
      if (seq !== joinSeqRef.current) return;
      if (everJoinedRef.current) {
        if (socket.connected) rejoinRef.current();
        return;
      }
      setStatus('error');
      setError('timeout');
    }, 12_000);
    socket.emit(
      WS_EVENTS.rtcJoin,
      { sessionId: sid, media: mediaRef.current, clientId: tabClientId() },
      (ack: RtcJoinAck) => {
        void (async () => {
          if (seq !== joinSeqRef.current || !wantJoinedRef.current) return;
          window.clearTimeout(timer);
          if (!ack?.ok || !ack.selfId) {
            if (everJoinedRef.current && ack?.error === 'media_unavailable') {
              window.setTimeout(() => rejoinRef.current(), 3_000);
              return;
            }
            setStatus('error');
            setError(ack?.error ?? 'join_failed');
            return;
          }
          // Apply the roster snapshot NOW, before anything async: from this
          // moment the server sends peer/producer events for this room, and
          // a snapshot applied later would overwrite them (lost people).
          const roster = (ack.peers ?? []).map((p) => ({
            ...p,
            camera: null,
            screen: null,
          }));
          selfIdRef.current = ack.selfId;
          callIdRef.current = ack.startedAt ?? null;
          // The server forgets my problems with the old connection.
          syncDiag();
          peersRef.current = roster;
          setSelfId(ack.selfId);
          setRole(ack.role ?? 'participant');
          setPeers(roster);
          for (const info of ack.producers ?? []) {
            knownRef.current.set(info.producerId, info);
          }
          try {
            const device = new Device();
            await device.load({
              routerRtpCapabilities:
                ack.routerRtpCapabilities as msc.RtpCapabilities,
            });
            if (seq !== joinSeqRef.current) return;
            deviceRef.current = device;
            recvRef.current = await createTransport('recv');
            if (seq !== joinSeqRef.current) return;
            everJoinedRef.current = true;
            setError(null);
            setStatus('joined');
            saveResume();
            syncConsumers();
            // (Re)publish whatever is on locally.
            const t = tracksRef.current;
            const m = mediaRef.current;
            const live = (x?: MediaStreamTrack) => !!x && x.readyState === 'live';
            if (live(t.mic)) {
              await publish('mic', t.mic!);
              if (!m.audio) {
                const p = producersRef.current.get('mic');
                p?.pause();
                if (p) {
                  socket.emit(WS_EVENTS.rtcProducerPause, {
                    producerId: p.id,
                    paused: true,
                  });
                }
              }
            }
            if (m.video && live(t.camera)) await publish('camera', t.camera!);
            if (m.screen && live(t.screen)) {
              await publish('screen', t.screen!);
              if (live(t['screen-audio'])) {
                await publish('screen-audio', t['screen-audio']!);
              }
            }
          } catch (err) {
            console.warn('[video] join failed', err);
            if (seq !== joinSeqRef.current) return;
            if (err instanceof Error && err.name === 'UnsupportedError') {
              setDiag('browser_unsupported', true);
            }
            if (everJoinedRef.current) {
              window.setTimeout(() => rejoinRef.current(), 2_000);
            } else {
              setStatus('error');
              setError('join_failed');
            }
          }
        })();
      },
    );
  }, [createTransport, publish, saveResume, setDiag, syncConsumers, syncDiag, teardown]);

  rejoinRef.current = () => {
    if (!wantJoinedRef.current) return;
    if (socketRef.current?.connected) doJoin();
    else setStatus('reconnecting');
  };

  const leaveInternal = useCallback(
    (opts: { keepResume?: boolean } = {}) => {
      wantJoinedRef.current = false;
      everJoinedRef.current = false;
      joinSeqRef.current++;
      const sid = sessionIdRef.current;
      // A remount keeps my place (the server holds it while I reconnect).
      if (sid && !opts.keepResume) socketRef.current?.emit(WS_EVENTS.rtcLeave, { sessionId: sid });
      if (!opts.keepResume) writeCallResume(sid, null);
      teardown();
      stopLocal();
      resetDiag();
      mediaRef.current = NO_MEDIA;
      setMedia(NO_MEDIA);
      setPeers([]);
      setSpeaking([]);
      setDominantId(null);
      lastSpokeRef.current.clear();
      stageRef.current = null;
      socketRef.current?.removeAllListeners();
      socketRef.current?.disconnect();
      socketRef.current = null;
      selfIdRef.current = null;
      setSelfId(null);
      setRole(null);
      setStatus('idle');
    },
    [resetDiag, stopLocal, teardown],
  );

  const leave = useCallback(() => leaveInternal(), [leaveInternal]);

  const ensureSocket = useCallback((): LiveSocket | null => {
    if (socketRef.current) return socketRef.current;
    const auth = tokenRef.current;
    if (!auth) return null;
    const live = resolveLiveSocket();
    const socket: LiveSocket = io(live.url, {
      path: live.path,
      transports: LIVE_SOCKET_TRANSPORTS,
      auth: { token: auth },
      query: { token: auth },
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 600,
      reconnectionDelayMax: 4_000,
      timeout: 12_000,
      forceNew: true,
    });
    socketRef.current = socket;

    socket.on('connect', () => {
      // First connect, or a new socket after a drop → (re)build everything.
      if (wantJoinedRef.current) doJoin();
    });
    socket.on('disconnect', () => {
      if (wantJoinedRef.current && everJoinedRef.current) setStatus('reconnecting');
    });
    socket.on('connect_error', (err) => {
      if (!wantJoinedRef.current) return;
      if (everJoinedRef.current) {
        setStatus('reconnecting'); // socket.io keeps retrying
        return;
      }
      setStatus('error');
      setError(err.message);
    });

    socket.on(WS_EVENTS.rtcPeerJoined, (peer) => {
      setPeers((prev) => {
        const old = prev.find((p) => p.peerId === peer.peerId);
        const next: RemotePeer = { ...peer, camera: null, screen: null };
        return old
          ? prev.map((p) => (p.peerId === peer.peerId ? next : p))
          : [...prev, next];
      });
    });
    socket.on(WS_EVENTS.rtcPeerLeft, ({ peerId }) => {
      for (const [id, info] of knownRef.current) {
        if (info.peerId !== peerId) continue;
        knownRef.current.delete(id);
        const entry = consumersRef.current.get(id);
        if (entry && !entry.consumer.closed) entry.consumer.close();
        consumersRef.current.delete(id);
      }
      lastSpokeRef.current.delete(peerId);
      setPeers((prev) => prev.filter((p) => p.peerId !== peerId));
      setDominantId((cur) => (cur === peerId ? null : cur));
      syncConsumers();
    });
    socket.on(WS_EVENTS.rtcPeerState, ({ peerId, media: m }) => {
      setPeers((prev) => prev.map((p) => (p.peerId === peerId ? { ...p, media: m } : p)));
    });
    socket.on(WS_EVENTS.rtcProducerNew, (info) => {
      if (info.peerId === selfIdRef.current) return;
      knownRef.current.set(info.producerId, info);
      syncConsumers();
    });
    socket.on(WS_EVENTS.rtcProducerClosed, ({ producerId, peerId }) => {
      knownRef.current.delete(producerId);
      const entry = consumersRef.current.get(producerId);
      if (entry) {
        if (!entry.consumer.closed) entry.consumer.close();
        consumersRef.current.delete(producerId);
        rebuildStreams(peerId);
      }
      syncConsumers();
    });
    socket.on(WS_EVENTS.rtcSpeakers, ({ speakers }) => {
      const now = Date.now();
      const ids = speakers.map((s) => s.peerId);
      for (const id of ids) lastSpokeRef.current.set(id, now);
      setSpeaking((prev) =>
        prev.length === ids.length && prev.every((id, i) => id === ids[i]) ? prev : ids,
      );
      // The floor goes to the loudest OTHER person; it stays with them
      // through pauses, so the stage does not jump around.
      const loudest = ids.find((id) => id !== selfIdRef.current);
      if (loudest) setDominantId((cur) => (cur === loudest ? cur : loudest));
    });
    socket.on(WS_EVENTS.rtcModerate, ({ action }) => {
      setModeratedAt({ action, at: Date.now() });
      const cur = mediaRef.current;
      if (action === 'mute' && cur.audio) {
        const p = producersRef.current.get('mic');
        if (p && !p.closed) {
          p.pause();
          socket.emit(WS_EVENTS.rtcProducerPause, { producerId: p.id, paused: true });
        }
        publishState({ ...cur, audio: false });
      } else if (action === 'stop-video' && cur.video) {
        tracksRef.current.camera?.stop();
        unpublish('camera');
        setLocalCamera(null);
        publishState({ ...cur, video: false });
        void syncBlurRef.current();
      } else if (action === 'lower-hand' && cur.hand) {
        publishState({ ...cur, hand: false });
      }
    });
    socket.on(WS_EVENTS.rtcCallEnded, () => {
      if (!wantJoinedRef.current) return;
      setEndedAt(Date.now());
      leaveInternal();
    });
    socket.on(WS_EVENTS.rtcReset, () => {
      if (wantJoinedRef.current) doJoin();
    });
    socket.on(WS_EVENTS.rtcReaction, (r) => {
      for (const cb of reactionListenersRef.current) cb(r);
    });
    // A teacher sent me a ready fix («Помощник тренера») — only to me.
    socket.on(WS_EVENTS.rtcDiagHint, ({ kind, from }) => {
      setDiagHint({ kind, from: typeof from === 'string' ? from : '', at: Date.now() });
    });
    return socket;
  }, [doJoin, leaveInternal, publishState, rebuildStreams, syncConsumers, unpublish]);

  // Leave on unmount / session change — but remember the call, so a reload
  // (where this cleanup may or may not run) brings the person straight back.
  useEffect(
    () => () => leaveInternal({ keepResume: true }),
    [sessionId, leaveInternal],
  );

  // Back online / tab visible again → make sure we are still connected.
  useEffect(() => {
    const check = () => {
      if (!wantJoinedRef.current) return;
      const socket = socketRef.current;
      if (socket && !socket.connected) socket.connect();
    };
    const onVisible = () => {
      if (document.visibilityState === 'visible') check();
    };
    window.addEventListener('online', check);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.removeEventListener('online', check);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, []);

  // ── local media ──────────────────────────────────────────────────────────

  const refreshLocalCamera = useCallback(() => {
    const t = tracksRef.current;
    const tracks = [t.camera ? sendTrackFor(t.camera) : undefined, t.mic].filter(
      (x): x is MediaStreamTrack => !!x && x.readyState === 'live',
    );
    setLocalCamera(tracks.length ? new MediaStream(tracks) : null);
  }, [sendTrackFor]);

  // ── background blur ──────────────────────────────────────────────────────

  /** Point the camera producer and the local preview at the current send
   * track (blurred or raw). Never throws. */
  const swapCamera = useCallback(async () => {
    const raw = tracksRef.current.camera;
    const producer = producersRef.current.get('camera');
    if (raw && producer && !producer.closed) {
      try {
        await producer.replaceTrack({ track: sendTrackFor(raw) });
      } catch (err) {
        console.warn('[video] camera track swap failed', err);
        // Blurred track refused → make sure the raw one is what goes out.
        const b = blurRef.current;
        if (b) {
          blurRef.current = null;
          b.stop();
          setBlurActive(false);
          await producer.replaceTrack({ track: raw }).catch(() => undefined);
        }
      }
    }
    refreshLocalCamera();
  }, [refreshLocalCamera, sendTrackFor]);

  /** Blur stopped by itself: back to the raw camera at once. */
  const onBlurFail = useCallback(
    (pipeline: () => BlurPipeline | null) => (code: BlurFailure) => {
      const p = pipeline();
      if (!p || blurRef.current !== p) return;
      blurRef.current = null;
      setBlurActive(false);
      void swapCamera();
      setBlurError({ code, at: Date.now() });
      // A computer that cannot keep up will not do better next time.
      blurWantRef.current = false;
      setBlurOn(false);
      if (code === 'slow') writeBlurPref(false);
    },
    [swapCamera],
  );

  /**
   * Make the blur pipeline match the wish + the camera: start it on the
   * current raw camera track, or stop it. Serialized; any failure leaves the
   * raw camera in place. `timeoutMs` bounds the wait for the first frame.
   */
  const syncBlur = useCallback(
    (timeoutMs = 60_000): Promise<void> => {
      const run = async () => {
        const raw = tracksRef.current.camera;
        const want =
          blurWantRef.current && blurOkRef.current && !!raw && raw.readyState === 'live';
        const cur = blurRef.current;
        if (cur && (!want || cur.input !== raw)) {
          blurRef.current = null;
          setBlurActive(false);
          await swapCamera();
          cur.stop();
        }
        if (!want || blurRef.current || !raw) return;
        setBlurBusy(true);
        let made: BlurPipeline | null = null;
        try {
          let timedOut = false;
          const started = startBackgroundBlur(raw, onBlurFail(() => made));
          const timeout = new Promise<never>((_, reject) =>
            window.setTimeout(() => {
              timedOut = true;
              reject(new BlurError('failed', 'start timeout'));
            }, timeoutMs),
          );
          // A late start after the timeout must not leak.
          started.then(
            (p) => {
              if (timedOut) p.stop();
            },
            () => undefined,
          );
          made = await Promise.race([started, timeout]);
        } catch (err) {
          const code: BlurFailure = err instanceof BlurError ? err.code : 'failed';
          console.warn('[video] background blur unavailable', err);
          if (code === 'unsupported') {
            blurOkRef.current = false;
            setBlurOk(false);
          }
          blurWantRef.current = false;
          setBlurOn(false);
          setBlurError({ code, at: Date.now() });
          return;
        } finally {
          setBlurBusy(false);
        }
        const pipeline = made;
        // The camera changed or blur was switched off while starting.
        if (tracksRef.current.camera !== raw || !blurWantRef.current || raw.readyState !== 'live') {
          pipeline.stop();
          return;
        }
        blurRef.current = pipeline;
        setBlurActive(true);
        await swapCamera();
      };
      const next = blurQueueRef.current.then(run, run).catch((err) => {
        console.warn('[video] blur sync failed', err);
      });
      blurQueueRef.current = next;
      return next;
    },
    [onBlurFail, swapCamera],
  );

  syncBlurRef.current = syncBlur;

  const setBlur = useCallback(
    (on: boolean) => {
      if (on && !blurOkRef.current) return;
      blurWantRef.current = on;
      setBlurOn(on);
      writeBlurPref(on);
      if (!on) setBlurError(null);
      void syncBlur();
    },
    [syncBlur],
  );

  const enableAudio = useCallback(async (): Promise<boolean> => {
    const existing = tracksRef.current.mic;
    if (existing && existing.readyState === 'live') {
      existing.enabled = true;
      await publish('mic', existing);
      return true;
    }
    let s: MediaStream;
    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new DOMException('no mediaDevices', 'NotFoundError');
      }
      s = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
    } catch (err) {
      const kind = mediaErrorKind(err, 'mic');
      for (const k of ['mic_denied', 'mic_missing', 'mic_busy'] as const) setDiag(k, k === kind);
      throw err;
    }
    for (const k of ['mic_denied', 'mic_missing', 'mic_busy'] as const) setDiag(k, false);
    const track = s.getAudioTracks()[0];
    if (!track) return false;
    await publish('mic', track);
    refreshLocalCamera();
    return true;
  }, [publish, refreshLocalCamera, setDiag]);

  const enableVideo = useCallback(async (): Promise<boolean> => {
    let s: MediaStream;
    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new DOMException('no mediaDevices', 'NotFoundError');
      }
      s = await navigator.mediaDevices.getUserMedia({
        video: {
          // HD capture: the recording and the local picture use it in full;
          // what goes to the others is shaped by CAMERA_ENCODINGS.
          width: { ideal: 1280 },
          height: { ideal: 720 },
          frameRate: { ideal: 30, max: 30 },
        },
      });
    } catch (err) {
      const kind = mediaErrorKind(err, 'cam');
      for (const k of ['cam_denied', 'cam_missing', 'cam_busy'] as const) setDiag(k, k === kind);
      throw err;
    }
    for (const k of ['cam_denied', 'cam_missing', 'cam_busy'] as const) setDiag(k, false);
    const track = s.getVideoTracks()[0];
    if (!track) return false;
    tracksRef.current.camera?.stop();
    tracksRef.current.camera = track;
    // Blur on: the first thing anyone sees is already blurred (bounded
    // wait — on any trouble the raw camera goes out).
    if (blurWantRef.current && blurOkRef.current) {
      await Promise.race([syncBlur(), new Promise((r) => window.setTimeout(r, 6_000))]);
    }
    await publish('camera', track);
    refreshLocalCamera();
    return true;
  }, [publish, refreshLocalCamera, setDiag, syncBlur]);

  const join = useCallback(
    async (opts: { audio?: boolean; video?: boolean } = {}) => {
      if (!sessionIdRef.current || wantJoinedRef.current) return;
      setError(null);
      setEndedAt(null);
      wantJoinedRef.current = true;
      setStatus('joining');
      let next: RtcMediaState = { ...NO_MEDIA };
      try {
        // Tracks are captured first and sent once the room is joined.
        if (opts.audio && (await enableAudio())) next = { ...next, audio: true };
        if (opts.video && (await enableVideo())) next = { ...next, video: true };
      } catch {
        setError('media_denied');
      }
      if (!wantJoinedRef.current) return; // left while the prompt was open
      mediaRef.current = next;
      setMedia(next);
      const socket = ensureSocket();
      if (!socket) {
        wantJoinedRef.current = false;
        setStatus('error');
        setError('no_token');
        return;
      }
      if (socket.connected) doJoin();
    },
    [doJoin, enableAudio, enableVideo, ensureSocket],
  );

  const endCall = useCallback(() => {
    const sid = sessionIdRef.current;
    if (sid) socketRef.current?.emit(WS_EVENTS.rtcCallEnd, { sessionId: sid });
  }, []);

  const setRecording = useCallback((on: boolean) => {
    const sid = sessionIdRef.current;
    if (sid) socketRef.current?.emit(WS_EVENTS.rtcRecording, { sessionId: sid, on });
  }, []);

  const toggleAudio = useCallback(async () => {
    const cur = mediaRef.current;
    if (cur.audio) {
      const p = producersRef.current.get('mic');
      if (p && !p.closed) {
        p.pause();
        socketRef.current?.emit(WS_EVENTS.rtcProducerPause, {
          producerId: p.id,
          paused: true,
        });
      } else if (tracksRef.current.mic) {
        tracksRef.current.mic.enabled = false;
      }
      publishState({ ...cur, audio: false });
      return;
    }
    try {
      if (!(await enableAudio())) return;
      publishState({ ...mediaRef.current, audio: true });
    } catch {
      setError('media_denied');
    }
  }, [enableAudio, publishState]);

  const toggleVideo = useCallback(async () => {
    const cur = mediaRef.current;
    if (cur.video) {
      tracksRef.current.camera?.stop();
      unpublish('camera');
      refreshLocalCamera();
      publishState({ ...cur, video: false });
      void syncBlur();
      return;
    }
    try {
      if (!(await enableVideo())) return;
      publishState({ ...mediaRef.current, video: true });
    } catch {
      setError('media_denied');
    }
  }, [enableVideo, publishState, refreshLocalCamera, syncBlur, unpublish]);

  const stopScreen = useCallback(() => {
    const hadScreen = !!tracksRef.current.screen || mediaRef.current.screen;
    tracksRef.current.screen?.stop();
    tracksRef.current['screen-audio']?.stop();
    unpublish('screen');
    unpublish('screen-audio');
    setLocalScreen(null);
    if (hadScreen) publishState({ ...mediaRef.current, screen: false });
  }, [publishState, unpublish]);

  const screenBusyRef = useRef(false);
  const toggleScreen = useCallback(async () => {
    if (mediaRef.current.screen) {
      stopScreen();
      return;
    }
    if (screenBusyRef.current) return; // picker already open
    screenBusyRef.current = true;
    let s: MediaStream;
    try {
      s = await captureScreen();
    } catch (err) {
      screenBusyRef.current = false;
      if (err instanceof ScreenShareFailed) {
        setScreenError({ code: err.code, at: Date.now() });
        setDiag(SCREEN_DIAG[err.code], true, undefined, SCREEN_DIAG_TTL_MS);
      }
      return; // cancelled → silently
    }
    const track = s.getVideoTracks()[0];
    const audio = s.getAudioTracks()[0];
    if (!track) {
      for (const x of s.getTracks()) x.stop();
      screenBusyRef.current = false;
      setScreenError({ code: 'failed', at: Date.now() });
      setDiag('screen_failed', true, undefined, SCREEN_DIAG_TTL_MS);
      return;
    }
    // The browser's own «Stop sharing» bar (or the shared window closing)
    // ends the track → clean up everything, but only if it is still ours.
    track.addEventListener('ended', () => {
      if (tracksRef.current.screen === track) stopScreen();
    });
    audio?.addEventListener('ended', () => {
      if (tracksRef.current['screen-audio'] === audio) unpublish('screen-audio');
    });
    await tuneScreenTrack(track);
    try {
      if (track.readyState !== 'live') throw new Error('ended');
      setLocalScreen(new MediaStream([track]));
      publishState({ ...mediaRef.current, screen: true });
      await publish('screen', track);
    } catch (err) {
      // Ended before it was sent = the user stopped it right away; not an error.
      const stoppedByUser = track.readyState !== 'live';
      if (!stoppedByUser) console.warn('[video] screen share failed', err);
      track.stop();
      audio?.stop();
      stopScreen();
      if (!stoppedByUser) {
        setScreenError({ code: 'failed', at: Date.now() });
        setDiag('screen_failed', true, undefined, SCREEN_DIAG_TTL_MS);
      }
      screenBusyRef.current = false;
      return;
    }
    screenBusyRef.current = false;
    for (const k of Object.values(SCREEN_DIAG)) setDiag(k, false);
    if (tracksRef.current.screen !== track) {
      // Stopped from the browser bar while it was being sent: drop the
      // producer that finished after the cleanup.
      if (producersRef.current.get('screen')?.track === track) unpublish('screen');
      audio?.stop();
      return;
    }
    // Tab/system audio is a bonus: if it cannot be sent, the picture stays.
    if (audio && audio.readyState === 'live' && tracksRef.current.screen === track) {
      try {
        await publish('screen-audio', audio);
      } catch (err) {
        console.warn('[video] screen audio failed, sharing video only', err);
        audio.stop();
        unpublish('screen-audio');
      }
    } else {
      audio?.stop();
    }
  }, [publish, publishState, setDiag, stopScreen, unpublish]);

  // ── «Помощник тренера»: local detectors ─────────────────────────────────

  const reportDiag = useCallback(
    (kind: RtcDiagKind, on: boolean, detail?: string) => setDiag(kind, on, detail),
    [setDiag],
  );

  // Talking with the mic off for > 3 s → a hint to me (and to teachers).
  // Listens to a clone of the muted mic; never unmutes.
  const speechRef = useRef<MutedSpeechDetector | null>(null);
  if (!speechRef.current && typeof window !== 'undefined') {
    speechRef.current = new MutedSpeechDetector((talking) => {
      setDiag('muted_speaking', talking);
      if (talking) setDiagHint({ kind: 'muted_speaking', from: null, at: Date.now() });
    });
  }
  const joinedNow = status === 'joined' || status === 'reconnecting';
  const micTrack = localCamera?.getAudioTracks()[0] ?? null;
  useEffect(() => {
    const det = speechRef.current;
    if (!det) return;
    if (joinedNow && !media.audio && micTrack && micTrack.readyState === 'live') {
      det.start(micTrack);
    } else {
      det.stop();
    }
  }, [joinedNow, media.audio, micTrack]);
  useEffect(() => () => speechRef.current?.stop(), []);

  // The call keeps reconnecting for > 10 s.
  useEffect(() => {
    if (status !== 'reconnecting') {
      setDiag('reconnecting', false);
      return;
    }
    const timer = window.setTimeout(() => setDiag('reconnecting', true), 10_000);
    return () => window.clearTimeout(timer);
  }, [status, setDiag]);

  // A raised hand nobody answered for 2 minutes.
  useEffect(() => {
    if (!joinedNow || !media.hand) {
      setDiag('hand_waiting', false);
      return;
    }
    const timer = window.setTimeout(() => setDiag('hand_waiting', true), 2 * 60_000);
    return () => window.clearTimeout(timer);
  }, [joinedNow, media.hand, setDiag]);

  // Microphone blocked in the browser settings (seen without asking).
  useEffect(() => {
    if (!joinedNow || typeof navigator === 'undefined' || !navigator.permissions?.query) return;
    let perm: PermissionStatus | null = null;
    let alive = true;
    const apply = () => {
      if (!perm || !alive) return;
      setDiag('mic_denied', perm.state === 'denied');
    };
    navigator.permissions
      .query({ name: 'microphone' as PermissionName })
      .then((p) => {
        if (!alive) return;
        perm = p;
        // Only report a block, never «not asked yet».
        if (p.state === 'denied') apply();
        p.onchange = apply;
      })
      .catch(() => undefined);
    return () => {
      alive = false;
      if (perm) perm.onchange = null;
    };
  }, [joinedNow, setDiag]);

  // Very poor connection: loss > 10% or RTT > 600 ms for ~10 s (getStats
  // every 4 s on the send transport, or the receive one when listen-only).
  useEffect(() => {
    if (status !== 'joined') return;
    const quality = new NetQuality();
    let bad = 0;
    let good = 0;
    let lastTransport: msc.Transport | null = null;
    const id = window.setInterval(() => {
      const send = sendRef.current;
      const transport = send && !send.closed && producersRef.current.size > 0 ? send : recvRef.current;
      if (!transport || transport.closed) return;
      if (transport !== lastTransport) {
        quality.reset();
        lastTransport = transport;
      }
      void transport
        .getStats()
        .then((report) => {
          const { loss, rtt } = quality.sample(report);
          const poor = (loss != null && loss > NET_LOSS_BAD) || (rtt != null && rtt > NET_RTT_BAD_MS);
          if (poor) {
            good = 0;
            bad += 1;
            if (bad >= NET_BAD_CHECKS) {
              const parts: string[] = [];
              if (loss != null) parts.push(`${Math.round(loss * 100)}%`);
              if (rtt != null) parts.push(`${Math.round(rtt)} ms`);
              setDiag('poor_network', true, parts.join(' · '));
            }
          } else {
            bad = 0;
            good += 1;
            if (good >= NET_BAD_CHECKS) setDiag('poor_network', false);
          }
        })
        .catch(() => undefined);
    }, NET_CHECK_MS);
    return () => window.clearInterval(id);
  }, [status, setDiag]);

  const sendReaction = useCallback((emoji: RtcReactionEmoji) => {
    const sid = sessionIdRef.current;
    const socket = socketRef.current;
    if (!sid || !socket?.connected || !selfIdRef.current) return;
    // Same limits as the server, so taps it would drop are not sent at all.
    const now = Date.now();
    const recent = reactionTimesRef.current.filter(
      (at) => now - at < RTC_REACTION_LIMIT.windowMs,
    );
    const last = recent[recent.length - 1];
    if (
      (last !== undefined && now - last < RTC_REACTION_LIMIT.minGapMs) ||
      recent.length >= RTC_REACTION_LIMIT.burst
    ) {
      reactionTimesRef.current = recent;
      return;
    }
    recent.push(now);
    reactionTimesRef.current = recent;
    socket.emit(WS_EVENTS.rtcReaction, { sessionId: sid, emoji });
  }, []);

  const subscribeReactions = useCallback((cb: (r: RtcReactionRelay) => void) => {
    const set = reactionListenersRef.current;
    set.add(cb);
    return () => {
      set.delete(cb);
    };
  }, []);

  const toggleHand = useCallback(() => {
    publishState({ ...mediaRef.current, hand: !mediaRef.current.hand });
  }, [publishState]);

  const moderate = useCallback((target: string, action: RtcModerateAction) => {
    const sid = sessionIdRef.current;
    if (!sid) return;
    socketRef.current?.emit(WS_EVENTS.rtcModerate, { sessionId: sid, target, action });
  }, []);

  const setStage = useCallback(
    (peerId: string | null) => {
      const prev = stageRef.current;
      if (prev === peerId) return;
      stageRef.current = peerId;
      for (const [producerId, info] of knownRef.current) {
        if (info.source !== 'camera') continue;
        if (info.peerId === prev) setLayer(producerId, 0);
        if (info.peerId === peerId) setLayer(producerId, 2);
      }
      syncConsumers();
    },
    [setLayer, syncConsumers],
  );

  return {
    status,
    error,
    selfId,
    role,
    peers,
    media,
    localCamera,
    localScreen,
    speaking,
    dominantId,
    join,
    leave,
    endCall,
    setRecording,
    toggleAudio,
    toggleVideo,
    toggleScreen,
    toggleHand,
    moderate,
    setStage,
    moderatedAt,
    endedAt,
    screenError,
    sendReaction,
    subscribeReactions,
    blur: { supported: blurOk, on: blurOn, active: blurActive, busy: blurBusy },
    setBlur,
    blurError,
    reportDiag,
    diagHint,
  };
}
