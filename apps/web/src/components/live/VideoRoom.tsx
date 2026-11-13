'use client';

import * as React from 'react';
import { useTranslations } from 'next-intl';
import {
  ArrowUpToLine,
  Circle,
  ExternalLink,
  Hand,
  Maximize,
  Mic,
  MicOff,
  Minimize,
  Minimize2,
  MonitorUp,
  MonitorX,
  PhoneOff,
  Pin,
  Square,
  Users,
  Video,
  VideoOff,
  VolumeX,
  X,
} from 'lucide-react';
import type { RtcMediaState } from '@lms/shared';
import { readCallResume, useVideoRoom, type RemotePeer } from '@/lib/rtc/useVideoRoom';
import {
  googleClientId,
  recordingSupported,
  requestDriveToken,
  startCallRecording,
  type CallRecorder,
  type RecordingResult,
} from '@/lib/rtc/recorder';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { cn } from '@/lib/utils';

/** Plays a MediaStream in a <video>. Audio is played separately (see below). */
function StreamVideo({
  stream,
  mirror,
  fit = 'cover',
  className,
}: {
  stream: MediaStream | null;
  mirror?: boolean;
  fit?: 'cover' | 'contain';
  className?: string;
}) {
  const ref = React.useRef<HTMLVideoElement>(null);
  React.useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (el.srcObject !== stream) el.srcObject = stream;
    if (stream) void el.play().catch(() => undefined);
  }, [stream]);
  return (
    <video
      ref={ref}
      autoPlay
      playsInline
      muted
      className={cn(
        'h-full w-full bg-black',
        fit === 'contain' ? 'object-contain' : 'object-cover',
        mirror && '-scale-x-100',
        className,
      )}
    />
  );
}

/** Invisible audio sink for one remote peer — survives layout changes. */
function PeerAudio({
  stream,
  onBlocked,
}: {
  stream: MediaStream | null;
  /** Browser refused autoplay (no user gesture yet, e.g. after a reload). */
  onBlocked?: () => void;
}) {
  const ref = React.useRef<HTMLAudioElement>(null);
  React.useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (el.srcObject !== stream) el.srcObject = stream;
    if (stream) void el.play().catch(() => onBlocked?.());
  }, [stream, onBlocked]);
  return <audio ref={ref} autoPlay data-peer-audio className="hidden" />;
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return (
    (parts[0]?.[0] ?? '?') + (parts.length > 1 ? (parts[1]?.[0] ?? '') : '')
  ).toUpperCase();
}

interface TileModel {
  id: string;
  name: string;
  isSelf: boolean;
  isHost: boolean;
  media: RtcMediaState;
  camera: MediaStream | null;
}

/** Three small bars that move while someone is talking. */
function SpeakingBars({ className }: { className?: string }) {
  return (
    <span className={cn('flex h-3 items-end gap-[2px]', className)} aria-hidden>
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className="w-[3px] origin-bottom animate-[speak_0.9s_ease-in-out_infinite] rounded-full bg-success"
          style={{ height: '100%', animationDelay: `${i * 0.15}s` }}
        />
      ))}
    </span>
  );
}

function Avatar({ name, size = 'md', speaking }: { name: string; size?: 'md' | 'xl'; speaking?: boolean }) {
  return (
    <span
      className={cn(
        'flex items-center justify-center rounded-full bg-primary font-semibold text-primary-foreground transition-shadow',
        size === 'xl' ? 'h-24 w-24 text-3xl sm:h-28 sm:w-28' : 'h-9 w-9 text-xs sm:h-11 sm:w-11 sm:text-sm',
        speaking && 'shadow-[0_0_0_4px_hsl(var(--success)/0.9),0_0_0_10px_hsl(var(--success)/0.25)]',
      )}
    >
      {initials(name)}
    </span>
  );
}

function Tile({
  tile,
  speaking,
  pinned,
  hostControls,
  onPin,
  onMute,
  onLowerHand,
  labels,
}: {
  tile: TileModel;
  speaking: boolean;
  pinned: boolean;
  hostControls: boolean;
  onPin: () => void;
  onMute: () => void;
  onLowerHand: () => void;
  labels: { host: string; mute: string; lowerHand: string; pin: string; unpin: string; speaking: string };
}) {
  const showVideo = tile.media.video && !!tile.camera;
  return (
    <div
      className={cn(
        'group relative aspect-video w-32 shrink-0 overflow-hidden rounded-lg bg-white/5 ring-2 transition-shadow sm:w-40',
        speaking ? 'ring-success' : tile.media.hand ? 'ring-warning' : pinned ? 'ring-primary' : 'ring-transparent',
      )}
    >
      <button
        type="button"
        onClick={onPin}
        title={pinned ? labels.unpin : labels.pin}
        aria-label={`${pinned ? labels.unpin : labels.pin}: ${tile.name}`}
        aria-pressed={pinned}
        className="block h-full w-full"
      >
        {showVideo ? (
          <StreamVideo stream={tile.camera} mirror={tile.isSelf} />
        ) : (
          <span className="flex h-full w-full items-center justify-center pb-4">
            <Avatar name={tile.name} speaking={speaking} />
          </span>
        )}
      </button>
      <div className="pointer-events-none absolute inset-x-0 bottom-0 flex items-center gap-1 bg-gradient-to-t from-black/80 to-transparent px-2 pb-1 pt-5 text-[11px] text-white">
        {speaking ? (
          <SpeakingBars className="shrink-0" />
        ) : tile.media.audio ? (
          <Mic className="h-3 w-3 shrink-0" aria-hidden />
        ) : (
          <MicOff className="h-3 w-3 shrink-0 text-red-400" aria-hidden />
        )}
        <span className="truncate">
          {tile.name}
          {!tile.isSelf && tile.isHost ? ` · ${labels.host}` : ''}
        </span>
        {speaking ? <span className="sr-only">{labels.speaking}</span> : null}
        {tile.media.hand ? (
          <Hand className="ml-auto h-3.5 w-3.5 shrink-0 text-warning" aria-hidden />
        ) : pinned ? (
          <Pin className="ml-auto h-3 w-3 shrink-0" aria-hidden />
        ) : null}
      </div>
      {hostControls && !tile.isSelf ? (
        <div className="absolute right-1 top-1 hidden gap-1 group-hover:flex group-focus-within:flex">
          {tile.media.audio ? (
            <button
              type="button"
              onClick={onMute}
              title={labels.mute}
              aria-label={`${labels.mute}: ${tile.name}`}
              className="rounded bg-black/70 p-1 text-white hover:bg-black"
            >
              <VolumeX className="h-3.5 w-3.5" />
            </button>
          ) : null}
          {tile.media.hand ? (
            <button
              type="button"
              onClick={onLowerHand}
              title={labels.lowerHand}
              aria-label={`${labels.lowerHand}: ${tile.name}`}
              className="rounded bg-black/70 p-1 text-white hover:bg-black"
            >
              <Hand className="h-3.5 w-3.5" />
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/**
 * Join window: camera preview, mic/camera switches and a plain-language
 * connection status before entering the call (like Meet's green room).
 */
function PreJoinDialog({
  isHost,
  busy,
  errorText,
  onJoin,
  onClose,
}: {
  isHost: boolean;
  busy: boolean;
  errorText: string | null;
  onJoin: (audio: boolean, video: boolean) => void;
  onClose: () => void;
}) {
  const t = useTranslations('videoRoom');
  const [mic, setMic] = React.useState(isHost);
  const [cam, setCam] = React.useState(isHost);
  const [preview, setPreview] = React.useState<MediaStream | null>(null);
  const [previewError, setPreviewError] = React.useState(false);
  const previewRef = React.useRef<MediaStream | null>(null);

  const stopPreview = React.useCallback(() => {
    previewRef.current?.getTracks().forEach((tr) => tr.stop());
    previewRef.current = null;
    setPreview(null);
  }, []);

  // Live camera preview while the camera switch is on.
  React.useEffect(() => {
    if (!cam) {
      stopPreview();
      return;
    }
    let cancelled = false;
    setPreviewError(false);
    navigator.mediaDevices
      ?.getUserMedia({ video: { width: { ideal: 640 }, height: { ideal: 360 } } })
      .then((s) => {
        if (cancelled) {
          s.getTracks().forEach((tr) => tr.stop());
          return;
        }
        previewRef.current = s;
        setPreview(s);
      })
      .catch(() => {
        if (!cancelled) setPreviewError(true);
      });
    return () => {
      cancelled = true;
      stopPreview();
    };
  }, [cam, stopPreview]);

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !busy) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [busy, onClose]);

  const enter = () => {
    stopPreview(); // free the camera for the call itself
    onJoin(mic, cam);
  };

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-foreground/60 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="prejoin-title"
      onClick={() => !busy && onClose()}
    >
      <div
        className="w-full max-w-lg space-y-4 rounded-xl border bg-card p-5 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div>
          <h2 id="prejoin-title" className="text-lg font-semibold">
            {isHost ? t('preTitleHost') : t('preTitle')}
          </h2>
          <p className="text-sm text-muted-foreground">{t('preSubtitle')}</p>
        </div>

        <div className="relative aspect-video w-full overflow-hidden rounded-lg bg-muted">
          {cam && preview ? (
            <StreamVideo stream={preview} mirror />
          ) : (
            <div className="flex h-full w-full flex-col items-center justify-center gap-2 px-6 text-center text-sm text-muted-foreground">
              <VideoOff className="h-7 w-7" aria-hidden />
              {cam && previewError ? t('permissionHint') : cam ? t('previewLoading') : t('previewOff')}
            </div>
          )}
        </div>

        <div className="grid grid-cols-2 gap-2">
          <Button
            type="button"
            variant={mic ? 'secondary' : 'outline'}
            onClick={() => setMic((v) => !v)}
            aria-pressed={mic}
            disabled={busy}
          >
            {mic ? <Mic className="h-4 w-4" /> : <MicOff className="h-4 w-4 text-destructive" />}
            {mic ? t('micIsOn') : t('micIsOff')}
          </Button>
          <Button
            type="button"
            variant={cam ? 'secondary' : 'outline'}
            onClick={() => setCam((v) => !v)}
            aria-pressed={cam}
            disabled={busy}
          >
            {cam ? <Video className="h-4 w-4" /> : <VideoOff className="h-4 w-4 text-destructive" />}
            {cam ? t('camIsOn') : t('camIsOff')}
          </Button>
        </div>

        {busy ? (
          <p className="flex items-center gap-2 rounded-md bg-primary/10 px-3 py-2 text-sm text-primary" role="status">
            <Spinner className="h-4 w-4" /> {t('connecting')}
          </p>
        ) : errorText ? (
          <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive" role="alert">
            {errorText}
          </p>
        ) : null}

        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose} disabled={busy}>
            {t('cancel')}
          </Button>
          <Button type="button" onClick={enter} disabled={busy} autoFocus>
            {busy ? <Spinner className="h-4 w-4" /> : <Video className="h-4 w-4" />}
            {errorText ? t('retry') : t('enter')}
          </Button>
        </div>
      </div>
    </div>
  );
}

type FloatSide = 'left' | 'right';

/**
 * Round, draggable bubble the call shrinks into while the page is scrolled.
 * Drag it up/down or to the other side (it snaps to the nearest edge); a
 * tap without dragging opens the mini-window again.
 */
function CallBubble({
  stream,
  mirror,
  fallback,
  side,
  bottom,
  ringClass,
  badge,
  label,
  onMove,
  onOpen,
}: {
  stream: MediaStream | null;
  mirror?: boolean;
  fallback: React.ReactNode;
  side: FloatSide;
  bottom: number;
  ringClass: string;
  badge?: React.ReactNode;
  label: string;
  onMove: (side: FloatSide, bottom: number) => void;
  onOpen: () => void;
}) {
  const SIZE = 84;
  const drag = React.useRef<{ x: number; y: number; moved: boolean } | null>(null);
  const [live, setLive] = React.useState<{ x: number; y: number } | null>(null);

  const onPointerDown = (e: React.PointerEvent) => {
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    drag.current = { x: e.clientX, y: e.clientY, moved: false };
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    if (!d.moved && Math.hypot(e.clientX - d.x, e.clientY - d.y) < 6) return;
    d.moved = true;
    setLive({ x: e.clientX - SIZE / 2, y: e.clientY - SIZE / 2 });
  };
  const onPointerUp = (e: React.PointerEvent) => {
    const d = drag.current;
    drag.current = null;
    if (!d || !d.moved) {
      setLive(null);
      onOpen();
      return;
    }
    const nextSide: FloatSide = e.clientX < window.innerWidth / 2 ? 'left' : 'right';
    const nextBottom = Math.min(
      Math.max(window.innerHeight - e.clientY - SIZE / 2, 16),
      window.innerHeight - SIZE - 16,
    );
    setLive(null);
    onMove(nextSide, nextBottom);
  };

  const style: React.CSSProperties = live
    ? { left: live.x, top: live.y, width: SIZE, height: SIZE }
    : { [side]: 16, bottom, width: SIZE, height: SIZE };

  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') onOpen();
      }}
      style={style}
      className={cn(
        'fixed z-40 transform-gpu touch-none select-none rounded-full p-1 shadow-2xl transition-[left,right,bottom] duration-200',
        live ? 'cursor-grabbing transition-none' : 'cursor-grab',
        ringClass,
      )}
    >
      <span className="relative block h-full w-full overflow-hidden rounded-full bg-card">
        {stream ? (
          <StreamVideo stream={stream} mirror={mirror} className="pointer-events-none" />
        ) : (
          <span className="flex h-full w-full items-center justify-center bg-gradient-to-br from-primary/25 to-primary/5 text-primary">
            {fallback}
          </span>
        )}
      </span>
      {badge}
    </button>
  );
}

interface StageModel {
  kind: 'screen' | 'camera' | 'avatar';
  /** Peer on the stage ('self' for me). */
  peerId: string;
  name: string;
  label: string;
  stream: MediaStream | null;
  mirror: boolean;
}

/** mm:ss since `since` — its own component so only it re-renders each second. */
function Elapsed({ since }: { since: number }) {
  const [now, setNow] = React.useState(() => Date.now());
  React.useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);
  const s = Math.max(0, Math.floor((now - since) / 1000));
  const pad = (n: number) => String(n).padStart(2, '0');
  const h = Math.floor(s / 3600);
  return (
    <span className="tabular-nums">
      {h > 0 ? `${h}:` : ''}
      {pad(Math.floor((s % 3600) / 60))}:{pad(s % 60)}
    </span>
  );
}

/** Round control button of the call bar. */
function CtrlButton({
  on,
  danger,
  accent,
  label,
  onClick,
  children,
  className,
  compact,
}: {
  /** Active look (white) vs resting (translucent). */
  on?: boolean;
  danger?: boolean;
  accent?: boolean;
  label: string;
  onClick: () => void;
  children: React.ReactNode;
  className?: string;
  compact?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
      className={cn(
        'inline-flex shrink-0 items-center justify-center rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/80 [&_svg]:h-5 [&_svg]:w-5',
        compact ? 'h-9 w-9 [&_svg]:h-4 [&_svg]:w-4' : 'h-11 w-11 sm:h-12 sm:w-12',
        danger
          ? 'bg-red-600 text-white hover:bg-red-500'
          : accent
            ? 'bg-warning text-warning-foreground hover:bg-warning/90'
            : on
              ? 'bg-white text-neutral-900 hover:bg-white/90'
              : 'bg-white/10 text-white hover:bg-white/20',
        className,
      )}
    >
      {children}
    </button>
  );
}

/**
 * «Видеосвязь» — the meeting room of a live session, built into the LMS
 * (no Google Meet / Zoom needed). Teacher and students see and hear each
 * other, share screens, raise hands; the host can mute and lower hands.
 *
 * Layout: a main stage (screen share, else whoever has the floor — the host
 * by default, the active speaker when someone else talks), a film strip of
 * everyone with the speaker highlighted, and one control bar. The stage can
 * go full screen. Docked at the top of the page; once it scrolls out of view
 * the call follows the user as a mini-window or a draggable bubble.
 *
 * The call survives reloads and network blips: it ends only when the host
 * ends it (or the session ends), and a reloaded tab comes straight back with
 * the microphone/camera it had.
 */
export function VideoRoom({
  sessionId,
  token,
  isHost,
  callState,
  autoJoin,
  recordingTitle,
  className,
}: {
  sessionId: string | undefined;
  token: string | null | undefined;
  /** Teacher page: joins with camera + mic on. */
  isHost?: boolean;
  /** Live call state of the session (from the session socket). */
  callState?: {
    active: boolean;
    count: number;
    startedAt: string | null;
    recording?: boolean;
  } | null;
  /** Lesson name used for the recording's file name. */
  recordingTitle?: string;
  /** Students: enter a running call automatically (listen-only). */
  autoJoin?: boolean;
  className?: string;
}) {
  const t = useTranslations('videoRoom');
  const room = useVideoRoom(sessionId, token);
  const [preJoinOpen, setPreJoinOpen] = React.useState(false);
  // Floating UI while the docked panel is out of view.
  const dockRef = React.useRef<HTMLElement | null>(null);
  const [dockVisible, setDockVisible] = React.useState(true);
  // Phones: start as the small circle so the lesson stays readable.
  const [floatMode, setFloatMode] = React.useState<'mini' | 'bubble'>(() =>
    typeof window !== 'undefined' && window.innerWidth < 640 ? 'bubble' : 'mini',
  );
  const [floatSide, setFloatSide] = React.useState<FloatSide>('right');
  const [bubbleBottom, setBubbleBottom] = React.useState(24);
  const [pinnedId, setPinnedId] = React.useState<string | null>(null);
  const [leaveMenu, setLeaveMenu] = React.useState(false);

  const joined = room.status === 'joined' || room.status === 'reconnecting';
  const reconnecting = room.status === 'reconnecting';
  const amHost = room.role === 'host';

  // The join window closes by itself once we are in the call.
  React.useEffect(() => {
    if (joined) setPreJoinOpen(false);
  }, [joined]);

  const [toast, setToast] = React.useState<string | null>(null);
  const toastTimer = React.useRef<number | null>(null);
  const showToast = React.useCallback((msg: string, ms = 4500) => {
    setToast(msg);
    if (toastTimer.current) window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), ms);
  }, []);
  React.useEffect(
    () => () => {
      if (toastTimer.current) window.clearTimeout(toastTimer.current);
    },
    [],
  );

  React.useEffect(() => {
    if (!room.moderatedAt) return;
    const key =
      room.moderatedAt.action === 'mute'
        ? 'mutedByHost'
        : room.moderatedAt.action === 'stop-video'
          ? 'videoStoppedByHost'
          : 'handLoweredByHost';
    showToast(t(key));
  }, [room.moderatedAt, t, showToast]);

  // The host ended the call while I was in it.
  React.useEffect(() => {
    if (room.endedAt) showToast(t('callEnded'), 6000);
  }, [room.endedAt, showToast, t]);

  // ── auto-join ───────────────────────────────────────────────────────────
  // Students enter a running call automatically, listen-only (no permission
  // prompt). Anyone who was in the call before a reload comes back with the
  // mic/camera they had. Leaving on purpose opts out of this call; a new
  // call (new startedAt) brings students in again.
  const optedOutOf = React.useRef<string | null>(null);
  const callActive = !!callState?.active;
  const callKnown = callState != null;
  const callId = callState?.startedAt ?? null;
  const { join: joinCall, leave: leaveRoom, endCall, status: roomStatus } = room;
  React.useEffect(() => {
    if (!callActive || !sessionId) return;
    if (roomStatus !== 'idle' || preJoinOpen) return;
    if (optedOutOf.current && optedOutOf.current === callId) return;
    const resume = readCallResume(sessionId);
    const back = resume && resume.callId === callId ? resume : null;
    if (!autoJoin && !back) return;
    // Spread a whole class over ~3 s so the API is not hit by every join in
    // the same instant; a returning tab reconnects at once.
    const timer = window.setTimeout(
      () => void joinCall({ audio: !!back?.audio, video: !!back?.video }),
      back ? 0 : Math.random() * 3000,
    );
    return () => window.clearTimeout(timer);
  }, [autoJoin, callActive, callId, sessionId, roomStatus, preJoinOpen, joinCall]);

  // Safety net for a missed "call ended" (e.g. I was offline at that moment):
  // a student left alone in a call that is not running leaves after a while.
  React.useEffect(() => {
    if (!autoJoin || !callKnown || callActive || roomStatus !== 'joined') return;
    const timer = window.setTimeout(() => {
      leaveRoom();
      showToast(t('callEnded'), 6000);
    }, 25_000);
    return () => window.clearTimeout(timer);
  }, [autoJoin, callKnown, callActive, roomStatus, leaveRoom, showToast, t]);

  const leaveCall = React.useCallback(() => {
    optedOutOf.current = callId;
    setLeaveMenu(false);
    leaveRoom();
  }, [callId, leaveRoom]);

  const endForAll = React.useCallback(() => {
    optedOutOf.current = callId;
    setLeaveMenu(false);
    endCall();
  }, [callId, endCall]);

  // Autoplay can be blocked until the user interacts with the page.
  const [audioBlocked, setAudioBlocked] = React.useState(false);
  const onAudioBlocked = React.useCallback(() => setAudioBlocked(true), []);
  const unblockAudio = React.useCallback(() => {
    document
      .querySelectorAll<HTMLAudioElement>('audio[data-peer-audio]')
      .forEach((a) => void a.play().catch(() => undefined));
    setAudioBlocked(false);
  }, []);

  // Watch the docked panel: when it leaves the viewport the call floats.
  React.useEffect(() => {
    const el = dockRef.current;
    if (!el || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver(
      ([entry]) => setDockVisible(!!entry?.isIntersecting),
      // Ignore the top strip covered by sticky headers.
      { rootMargin: '-96px 0px 0px 0px', threshold: 0.05 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [joined]);

  const backToCall = React.useCallback(() => {
    dockRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, []);

  // ── who is where ────────────────────────────────────────────────────────
  const selfKey = room.selfId ?? 'self';
  const speakingSet = React.useMemo(() => new Set(room.speaking), [room.speaking]);

  const tiles = React.useMemo<TileModel[]>(() => {
    const self: TileModel = {
      id: selfKey,
      name: t('you'),
      isSelf: true,
      isHost: amHost,
      media: room.media,
      camera: room.localCamera,
    };
    const others = room.peers.map<TileModel>((p: RemotePeer) => ({
      id: p.peerId,
      name: p.name,
      isSelf: false,
      isHost: p.role === 'host',
      media: p.media,
      camera: p.camera,
    }));
    // Hosts first, then raised hands, then people on camera — a stable order
    // (speaking is shown by the ring, not by reshuffling the strip).
    others.sort(
      (a, b) =>
        Number(b.isHost) - Number(a.isHost) ||
        Number(b.media.hand) - Number(a.media.hand) ||
        Number(b.media.video) - Number(a.media.video),
    );
    return [self, ...others];
  }, [selfKey, room.media, room.localCamera, room.peers, amHost, t]);

  // Stage: a screen share wins. Otherwise whoever has the floor — a pinned
  // person, else the active speaker, else the host, else anyone on camera.
  const stage = React.useMemo<StageModel | null>(() => {
    const sharer = room.peers.find((p) => p.media.screen && p.screen);
    if (sharer) {
      return {
        kind: 'screen',
        peerId: sharer.peerId,
        name: sharer.name,
        label: t('screenOf', { name: sharer.name }),
        stream: sharer.screen,
        mirror: false,
      };
    }
    if (room.media.screen && room.localScreen) {
      return {
        kind: 'screen',
        peerId: selfKey,
        name: t('you'),
        label: t('yourScreen'),
        stream: room.localScreen,
        mirror: false,
      };
    }
    const onCam = (p: RemotePeer | undefined) => !!p && p.media.video && !!p.camera;
    const byId = (id: string | null) => room.peers.find((p) => p.peerId === id);
    const pinned = byId(pinnedId);
    const speaker = byId(room.dominantId);
    const host = room.peers.find((p) => p.role === 'host');
    const selfOnCam = room.media.video && !!room.localCamera;
    const selfStage = (video: boolean): StageModel => ({
      kind: video ? 'camera' : 'avatar',
      peerId: selfKey,
      name: t('you'),
      label: t('you'),
      stream: video ? room.localCamera : null,
      mirror: true,
    });
    const peerStage = (p: RemotePeer): StageModel => {
      const video = onCam(p);
      return {
        kind: video ? 'camera' : 'avatar',
        peerId: p.peerId,
        name: p.name,
        label: p.role === 'host' ? `${p.name} · ${t('host')}` : p.name,
        stream: video ? p.camera : null,
        mirror: false,
      };
    };
    if (pinnedId === selfKey) return selfStage(selfOnCam);
    if (pinned) return peerStage(pinned);
    // A live picture always beats an avatar: speaker → host → anyone → me.
    const live =
      (onCam(speaker) ? speaker : undefined) ||
      (onCam(host) ? host : undefined) ||
      room.peers.find((p) => onCam(p));
    if (live) return peerStage(live);
    if (selfOnCam) return selfStage(true);
    const who = speaker || host;
    if (who) return peerStage(who);
    if (room.peers.length === 0) return selfStage(false);
    return null;
  }, [room.peers, room.media, room.localScreen, room.localCamera, room.dominantId, pinnedId, selfKey, t]);

  // The stage camera is received in the best quality, the strip in small.
  const { setStage } = room;
  const stageCamId = stage && stage.kind !== 'screen' && stage.peerId !== selfKey ? stage.peerId : null;
  React.useEffect(() => {
    if (joined) setStage(stageCamId);
  }, [joined, stageCamId, setStage]);

  // While a screen is shared, the person talking stays visible in a corner.
  const pip = React.useMemo(() => {
    if (stage?.kind !== 'screen') return null;
    const cand =
      room.peers.find((p) => p.peerId === room.dominantId && p.media.video && p.camera) ??
      room.peers.find((p) => p.peerId === stage.peerId && p.media.video && p.camera) ??
      room.peers.find((p) => p.role === 'host' && p.media.video && p.camera);
    if (cand) return { id: cand.peerId, name: cand.name, stream: cand.camera, mirror: false };
    if (stage.peerId === selfKey && room.media.video && room.localCamera) {
      return { id: selfKey, name: t('you'), stream: room.localCamera, mirror: true };
    }
    return null;
  }, [stage, room.peers, room.dominantId, room.media.video, room.localCamera, selfKey, t]);

  // ── full screen ─────────────────────────────────────────────────────────
  // Real Fullscreen API where it exists; a fixed full-window layer otherwise
  // (iPhone Safari has no element fullscreen).
  const stageRef = React.useRef<HTMLDivElement | null>(null);
  const [expanded, setExpanded] = React.useState(false);
  const toggleExpanded = React.useCallback(() => {
    setExpanded((cur) => {
      const next = !cur;
      const el = stageRef.current;
      if (next) void el?.requestFullscreen?.().catch(() => undefined);
      else if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
      return next;
    });
  }, []);
  React.useEffect(() => {
    const onChange = () => {
      if (!document.fullscreenElement) setExpanded(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setExpanded(false);
    };
    document.addEventListener('fullscreenchange', onChange);
    window.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('fullscreenchange', onChange);
      window.removeEventListener('keydown', onKey);
    };
  }, []);
  React.useEffect(() => {
    if (!joined && expanded) {
      setExpanded(false);
      if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
    }
  }, [joined, expanded]);

  // ── recording (host) ────────────────────────────────────────────────────
  // Recorded in the host's browser and streamed to their Google Drive
  // (folder «Уроки LMS»); see lib/rtc/recorder.ts.
  const recorderRef = React.useRef<CallRecorder | null>(null);
  const [rec, setRec] = React.useState<'idle' | 'starting' | 'on' | 'saving'>('idle');
  const [recSince, setRecSince] = React.useState(0);
  const [recResult, setRecResult] = React.useState<RecordingResult | null>(null);
  const { setRecording: announceRecording } = room;

  const stopRecording = React.useCallback(async () => {
    const recorder = recorderRef.current;
    if (!recorder) return;
    recorderRef.current = null;
    setRec('saving');
    announceRecording(false);
    try {
      setRecResult(await recorder.stop());
    } finally {
      setRec('idle');
    }
  }, [announceRecording]);

  const startRecording = React.useCallback(async () => {
    if (recorderRef.current || rec !== 'idle') return;
    setRecResult(null);
    setRec('starting');
    let driveToken: string | null = null;
    const clientId = googleClientId();
    if (clientId) {
      // Opens Google's window; must run inside this click.
      driveToken = await requestDriveToken(clientId).catch(() => null);
      if (!driveToken) showToast(t('recDriveDenied'), 7000);
    }
    try {
      const recorder = await startCallRecording({
        title: recordingTitle || t('recDefaultTitle'),
        driveToken,
      });
      recorder.onError = () => void stopRecording();
      recorderRef.current = recorder;
      setRecSince(Date.now());
      setRec('on');
      announceRecording(true);
      if (driveToken && recorder.target !== 'drive') showToast(t('recDriveDenied'), 7000);
    } catch {
      setRec('idle');
      showToast(t('recFailed'), 6000);
    }
  }, [rec, recordingTitle, announceRecording, showToast, stopRecording, t]);

  // Keep the recorder's picture and sound in step with the call.
  React.useEffect(() => {
    if (rec !== 'on') return;
    recorderRef.current?.setScene({
      main: stage?.stream ?? null,
      mainMirror: stage?.mirror,
      mainContain: stage?.kind === 'screen',
      label: stage?.label ?? '',
      pip: pip?.stream ?? null,
      pipMirror: pip?.mirror,
    });
  }, [rec, stage, pip]);
  React.useEffect(() => {
    if (rec !== 'on') return;
    const streams: MediaStream[] = [];
    for (const p of room.peers) {
      if (p.camera) streams.push(p.camera);
      if (p.screen) streams.push(p.screen);
    }
    if (room.localCamera) streams.push(room.localCamera);
    recorderRef.current?.setAudio(streams);
  }, [rec, room.peers, room.localCamera]);

  // Leaving the call (or the call ending) closes the file properly.
  React.useEffect(() => {
    if (!joined && recorderRef.current) void stopRecording();
  }, [joined, stopRecording]);
  // The file is finished only on «stop» — warn before closing the tab.
  React.useEffect(() => {
    if (rec !== 'on' && rec !== 'saving') return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [rec]);
  const someoneRecords = rec === 'on' || !!callState?.recording;

  const hands = room.peers.filter((p) => p.media.hand).length;
  const people = room.peers.length + 1;

  const errorText = room.error
    ? t.has(`errors.${room.error}`)
      ? t(`errors.${room.error}`)
      : t('errors.join_failed')
    : null;

  const tileLabels = {
    host: t('host'),
    mute: t('mute'),
    lowerHand: t('lowerHand'),
    pin: t('pin'),
    unpin: t('unpin'),
    speaking: t('speakingNow'),
  };

  // Shown in and out of the call (e.g. «Преподаватель завершил видеосвязь»).
  const toastEl = toast ? (
    <div
      role="status"
      className="fixed bottom-24 left-1/2 z-[80] max-w-[calc(100vw-2rem)] -translate-x-1/2 rounded-md bg-foreground px-4 py-2 text-center text-sm text-background shadow-lg"
    >
      {toast}
    </div>
  ) : null;

  // Where the finished recording went — stays until dismissed.
  const recResultEl = recResult ? (
    <div
      role="status"
      className="fixed bottom-5 left-1/2 z-[85] flex w-[min(34rem,calc(100vw-2rem))] -translate-x-1/2 items-start gap-3 rounded-xl border bg-card p-4 text-sm text-card-foreground shadow-2xl"
    >
      <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-success/15 text-success">
        <Circle className="h-3.5 w-3.5 fill-current" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="font-semibold">
          {recResult.where === 'drive' ? t('recSavedDrive') : t('recSavedDownload')}
        </p>
        <p className="truncate text-xs text-muted-foreground">{recResult.fileName}</p>
        {recResult.where === 'drive' && recResult.link ? (
          <a
            href={recResult.link}
            target="_blank"
            rel="noreferrer"
            className="mt-1 inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline"
          >
            {t('recOpenDrive')} <ExternalLink className="h-3.5 w-3.5" />
          </a>
        ) : recResult.where === 'download' ? (
          <p className="mt-1 text-xs text-muted-foreground">
            {googleClientId() ? t('recDriveFallback') : t('recDriveNotSetUp')}
          </p>
        ) : null}
      </div>
      <button
        type="button"
        onClick={() => setRecResult(null)}
        aria-label={t('cancel')}
        className="rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  ) : null;

  // ── not joined ──────────────────────────────────────────────────────────
  if (!joined) {
    const busy = room.status === 'joining';
    // Students wait for the teacher: joining an empty call makes no sense.
    const waiting = !!autoJoin && callKnown && !callActive;
    const rejoinHost = !!isHost && callActive;
    return (
      <>
        <section
          id="video-room"
          ref={dockRef}
          className={cn(
            'flex scroll-mt-28 flex-wrap items-center gap-3 rounded-xl border border-primary/30 bg-primary/5 p-4',
            className,
          )}
          aria-label={t('title')}
        >
          <span className="flex h-11 w-11 items-center justify-center rounded-full bg-primary text-primary-foreground">
            <Video className="h-5 w-5" aria-hidden />
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="text-sm font-semibold">{t('title')}</h2>
            <p className="text-xs text-muted-foreground">
              {busy
                ? t('connecting')
                : rejoinHost
                  ? t('callRunningHost', { count: callState?.count ?? 0 })
                  : isHost
                    ? t('hostHint')
                    : autoJoin && callActive
                      ? t('callRunning')
                      : autoJoin
                        ? t('waitingForCall')
                        : t('studentHint')}
            </p>
            {errorText && !preJoinOpen ? (
              <p className="mt-1 text-xs text-destructive" role="alert">
                {errorText}
              </p>
            ) : null}
          </div>
          <Button
            type="button"
            size="lg"
            onClick={() => setPreJoinOpen(true)}
            disabled={!sessionId || waiting || busy}
          >
            {busy ? <Spinner className="h-4 w-4" /> : <Video className="h-4 w-4" />}
            {rejoinHost ? t('rejoin') : isHost ? t('startCall') : waiting ? t('waitingShort') : t('join')}
          </Button>
        </section>
        {!dockVisible && sessionId && !preJoinOpen && !waiting ? (
          <button
            type="button"
            onClick={() => setPreJoinOpen(true)}
            className="fixed bottom-5 right-4 z-40 flex items-center gap-2 rounded-full bg-primary py-2 pl-2 pr-4 text-sm font-semibold text-primary-foreground shadow-2xl ring-4 ring-primary/20 transition hover:bg-primary/90"
          >
            <span className="flex h-10 w-10 items-center justify-center rounded-full bg-primary-foreground/15">
              {busy ? <Spinner className="h-4 w-4" /> : <Video className="h-5 w-5" />}
            </span>
            {rejoinHost ? t('rejoin') : isHost ? t('startCall') : t('join')}
          </button>
        ) : null}
        {toastEl}
        {recResultEl}
        {preJoinOpen ? (
          <PreJoinDialog
            isHost={!!isHost}
            busy={busy}
            errorText={errorText}
            onJoin={(audio, video) => void room.join({ audio, video })}
            onClose={() => setPreJoinOpen(false)}
          />
        ) : null}
      </>
    );
  }

  // ── joined ──────────────────────────────────────────────────────────────
  const micBtn = (compact = false) => (
    <CtrlButton
      compact={compact}
      on={room.media.audio}
      danger={!room.media.audio}
      label={room.media.audio ? t('micOff') : t('micOn')}
      onClick={() => void room.toggleAudio()}
    >
      {room.media.audio ? <Mic /> : <MicOff />}
    </CtrlButton>
  );
  const camBtn = (compact = false) => (
    <CtrlButton
      compact={compact}
      on={room.media.video}
      label={room.media.video ? t('camOff') : t('camOn')}
      onClick={() => void room.toggleVideo()}
    >
      {room.media.video ? <Video /> : <VideoOff />}
    </CtrlButton>
  );
  const handBtn = (compact = false) => (
    <CtrlButton
      compact={compact}
      accent={room.media.hand}
      label={room.media.hand ? t('lowerMyHand') : t('raiseHand')}
      onClick={room.toggleHand}
    >
      <Hand />
    </CtrlButton>
  );
  const fullBtn = (compact = false) => (
    <CtrlButton
      compact={compact}
      on={expanded}
      label={expanded ? t('exitFullscreen') : t('fullscreen')}
      onClick={toggleExpanded}
    >
      {expanded ? <Minimize /> : <Maximize />}
    </CtrlButton>
  );
  // Host: «leave» asks whether to end the call for everybody.
  const leaveBtn = (compact = false) => (
    <span className="relative">
      <button
        type="button"
        onClick={() => (amHost ? setLeaveMenu((v) => !v) : leaveCall())}
        title={t('leave')}
        aria-label={t('leave')}
        aria-haspopup={amHost ? 'menu' : undefined}
        aria-expanded={amHost ? leaveMenu : undefined}
        className={cn(
          'inline-flex shrink-0 items-center justify-center gap-2 rounded-full bg-red-600 font-semibold text-white transition-colors hover:bg-red-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/80',
          compact ? 'h-9 w-9' : 'h-11 px-4 text-sm sm:h-12 sm:px-5',
        )}
      >
        <PhoneOff className={compact ? 'h-4 w-4' : 'h-5 w-5'} />
        {compact ? null : <span className="hidden sm:inline">{t('leaveShort')}</span>}
      </button>
      {amHost && leaveMenu ? (
        <span
          role="menu"
          className="absolute bottom-full right-0 z-10 mb-2 flex w-64 flex-col gap-1 rounded-xl border bg-card p-1.5 text-left text-foreground shadow-2xl"
        >
          <button
            type="button"
            role="menuitem"
            onClick={endForAll}
            className="rounded-lg px-3 py-2 text-left hover:bg-destructive/10"
          >
            <span className="block text-sm font-semibold text-destructive">{t('endForAll')}</span>
            <span className="block text-xs text-muted-foreground">{t('endForAllHint')}</span>
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={leaveCall}
            className="rounded-lg px-3 py-2 text-left hover:bg-accent"
          >
            <span className="block text-sm font-semibold">{t('leaveOnly')}</span>
            <span className="block text-xs text-muted-foreground">{t('leaveOnlyHint')}</span>
          </button>
        </span>
      ) : null}
    </span>
  );

  const stageSpeaking = !!stage && stage.kind !== 'screen' && speakingSet.has(stage.peerId);

  /** The picture itself — reused by the dock stage and the mini-window. */
  const stageMedia = (big: boolean) =>
    !stage ? (
      <div className="flex h-full w-full flex-col items-center justify-center gap-2 text-center text-sm text-white/60">
        <VideoOff className="h-6 w-6" aria-hidden />
        {t('nobodyOnCamera')}
      </div>
    ) : stage.stream ? (
      <StreamVideo
        stream={stage.stream}
        fit={stage.kind === 'screen' || expanded ? 'contain' : 'cover'}
        mirror={stage.mirror}
      />
    ) : (
      <div className="flex h-full w-full items-center justify-center">
        <Avatar name={stage.name} size={big ? 'xl' : 'md'} speaking={stageSpeaking} />
      </div>
    );

  const stageLabel = stage ? (
    <span className="pointer-events-none absolute left-2 top-2 flex max-w-[75%] items-center gap-1.5 rounded-md bg-black/65 px-2 py-1 text-xs font-medium text-white">
      {stageSpeaking ? <SpeakingBars /> : stage.kind === 'screen' ? <MonitorUp className="h-3.5 w-3.5" /> : null}
      <span className="truncate">{stage.label}</span>
    </span>
  ) : null;

  const reconnectPill = reconnecting ? (
    <span
      role="status"
      className="pointer-events-none absolute left-1/2 top-2 z-10 flex -translate-x-1/2 items-center gap-2 rounded-full bg-amber-500 px-3 py-1 text-xs font-semibold text-black shadow"
    >
      <Spinner className="h-3.5 w-3.5" /> {t('reconnecting')}
    </span>
  ) : null;

  const liveDot = <span className="inline-flex h-2.5 w-2.5 shrink-0 rounded-full bg-success" />;

  // Teacher: raised hands need attention → amber ring. Otherwise live green.
  const bubbleRing = amHost && hands > 0 ? 'bg-warning animate-pulse' : reconnecting ? 'bg-amber-500' : 'bg-success';
  const bubbleBadge =
    amHost && hands > 0 ? (
      <span className="absolute -right-1 -top-1 flex h-7 min-w-7 items-center justify-center gap-0.5 rounded-full bg-warning px-1.5 text-xs font-bold text-warning-foreground shadow ring-2 ring-card">
        <Hand className="h-3.5 w-3.5" />
        {hands}
      </span>
    ) : !room.media.audio ? (
      <span className="absolute -right-1 -top-1 flex h-7 w-7 items-center justify-center rounded-full bg-destructive text-destructive-foreground shadow ring-2 ring-card">
        <MicOff className="h-3.5 w-3.5" />
      </span>
    ) : (
      <span className="absolute -right-1 -top-1 flex h-7 min-w-7 items-center justify-center gap-0.5 rounded-full bg-card px-1.5 text-xs font-semibold text-foreground shadow ring-2 ring-success">
        <Users className="h-3.5 w-3.5" />
        {people}
      </span>
    );

  const floatingUi = dockVisible || expanded ? null : floatMode === 'bubble' ? (
    <CallBubble
      stream={stage?.stream ?? null}
      mirror={stage?.mirror}
      fallback={<Users className="h-7 w-7" />}
      side={floatSide}
      bottom={bubbleBottom}
      ringClass={bubbleRing}
      badge={bubbleBadge}
      label={t('openMini')}
      onMove={(side, bottom) => {
        setFloatSide(side);
        setBubbleBottom(bottom);
      }}
      onOpen={() => setFloatMode('mini')}
    />
  ) : (
    <section
      className={cn(
        'fixed bottom-4 z-40 w-[min(280px,calc(100vw-2rem))] transform-gpu space-y-2 rounded-2xl bg-neutral-950 p-2 text-white shadow-2xl ring-1 ring-white/10 sm:w-[340px]',
        floatSide === 'right' ? 'right-4' : 'left-4',
      )}
      aria-label={t('title')}
    >
      <header className="flex items-center gap-2 px-1">
        {liveDot}
        <span className="min-w-0 flex-1 truncate text-xs font-semibold">
          {reconnecting ? t('reconnecting') : `${t('title')} · ${t('people', { count: people })}`}
        </span>
        {hands > 0 ? (
          <span className="inline-flex items-center gap-1 rounded-full bg-warning px-1.5 py-0.5 text-xs font-semibold text-warning-foreground">
            <Hand className="h-3.5 w-3.5" /> {hands}
          </span>
        ) : null}
        <button
          type="button"
          onClick={() => setFloatMode('bubble')}
          className="rounded-md p-1.5 text-white/70 hover:bg-white/10 hover:text-white"
          title={t('toBubble')}
          aria-label={t('toBubble')}
        >
          <Minimize2 className="h-4 w-4" />
        </button>
      </header>
      <button
        type="button"
        onClick={backToCall}
        className={cn(
          'relative block aspect-video w-full overflow-hidden rounded-lg bg-black ring-2',
          stageSpeaking ? 'ring-success' : 'ring-transparent',
        )}
        title={t('backToCall')}
        aria-label={t('backToCall')}
      >
        {stageMedia(false)}
        {stageLabel}
        {someoneRecords ? (
          <span className="absolute right-1.5 top-1.5 inline-flex items-center gap-1 rounded-full bg-red-600 px-1.5 py-0.5 text-[10px] font-semibold text-white">
            <span className="h-1.5 w-1.5 rounded-full bg-white" /> REC
          </span>
        ) : null}
      </button>
      {/* Everyone stays in sight while the page is scrolled. */}
      <div className="flex gap-1.5 overflow-x-auto pb-0.5 [scrollbar-width:none]">
        {tiles.map((tile) => {
          const speaks = speakingSet.has(tile.id);
          return (
            <button
              key={tile.id}
              type="button"
              onClick={() => setPinnedId((cur) => (cur === tile.id ? null : tile.id))}
              title={tile.name}
              aria-label={tile.name}
              className={cn(
                'relative h-12 w-[4.5rem] shrink-0 overflow-hidden rounded-md bg-white/5 ring-2',
                speaks ? 'ring-success' : tile.media.hand ? 'ring-warning' : pinnedId === tile.id ? 'ring-primary' : 'ring-transparent',
              )}
            >
              {tile.media.video && tile.camera ? (
                <StreamVideo stream={tile.camera} mirror={tile.isSelf} />
              ) : (
                <span className="flex h-full w-full items-center justify-center text-[11px] font-semibold text-white/90">
                  {initials(tile.name)}
                </span>
              )}
              <span className="absolute inset-x-0 bottom-0 flex items-center gap-0.5 bg-black/60 px-1 text-[9px] leading-4 text-white">
                {tile.media.hand ? <Hand className="h-2.5 w-2.5 shrink-0 text-warning" /> : !tile.media.audio ? <MicOff className="h-2.5 w-2.5 shrink-0 text-red-400" /> : null}
                <span className="truncate">{tile.name}</span>
              </span>
            </button>
          );
        })}
      </div>
      <div className="flex items-center justify-between gap-1.5">
        <div className="flex gap-1.5">
          {micBtn(true)}
          {camBtn(true)}
          {handBtn(true)}
        </div>
        <div className="flex gap-1.5">
          <CtrlButton compact label={t('backToCall')} onClick={backToCall}>
            <ArrowUpToLine />
          </CtrlButton>
          {leaveBtn(true)}
        </div>
      </div>
    </section>
  );

  return (
    <>
      {/* Audio for every remote peer, independent of the visible layout. */}
      {room.peers.map((p) => (
        <React.Fragment key={p.peerId}>
          <PeerAudio stream={p.camera} onBlocked={onAudioBlocked} />
          {p.screen && p.screen.getAudioTracks().length > 0 ? (
            <PeerAudio stream={p.screen} onBlocked={onAudioBlocked} />
          ) : null}
        </React.Fragment>
      ))}

      <section
        id="video-room"
        ref={dockRef}
        className={cn(
          'scroll-mt-28 space-y-3 rounded-2xl bg-neutral-950 p-3 text-white shadow-lg sm:p-4',
          className,
        )}
        aria-label={t('title')}
      >
        <header className="flex flex-wrap items-center gap-2">
          {liveDot}
          <h2 className="text-sm font-semibold">{t('title')}</h2>
          <span className="rounded-full bg-success/20 px-2 py-0.5 text-xs font-semibold text-success">
            {t('inCall')}
          </span>
          <span className="inline-flex items-center gap-1 text-xs text-white/60">
            <Users className="h-3.5 w-3.5" /> {t('people', { count: people })}
          </span>
          {hands > 0 ? (
            <span className="inline-flex items-center gap-1 rounded-full bg-warning px-2 py-0.5 text-xs font-semibold text-warning-foreground">
              <Hand className="h-3.5 w-3.5" /> {t('hands', { count: hands })}
            </span>
          ) : null}
          {someoneRecords ? (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-red-600 px-2 py-0.5 text-xs font-semibold text-white">
              <span className="h-2 w-2 animate-pulse rounded-full bg-white" />
              {t('recOn')}
              {rec === 'on' ? <Elapsed since={recSince} /> : null}
            </span>
          ) : null}
          <span className="ml-auto hidden text-xs text-white/50 md:inline">{t('scrollHint')}</span>
        </header>

        {/* Stage — also the element that goes full screen. */}
        <div
          ref={stageRef}
          onDoubleClick={toggleExpanded}
          className={cn(
            'relative overflow-hidden bg-black',
            expanded
              ? 'fixed inset-0 z-[70] flex flex-col'
              : cn(
                  // Never taller than ~60% of the window, so the lesson stays in reach.
                  'mx-auto aspect-video w-[min(100%,56rem,calc(60vh*16/9))] rounded-xl ring-2 transition-shadow',
                  stageSpeaking ? 'ring-success' : 'ring-white/10',
                ),
          )}
        >
          <div className={cn('relative min-h-0 w-full', expanded ? 'flex-1' : 'h-full')}>
            {stageMedia(true)}
            {stageLabel}
            {reconnectPill}
            {pip ? (
              <div
                className={cn(
                  'absolute bottom-2 right-2 aspect-video w-28 overflow-hidden rounded-lg bg-neutral-900 shadow-xl ring-2 sm:w-44',
                  speakingSet.has(pip.id) ? 'ring-success' : 'ring-white/30',
                )}
              >
                <StreamVideo stream={pip.stream} mirror={pip.mirror} />
                <span className="absolute inset-x-0 bottom-0 truncate bg-black/60 px-1.5 py-0.5 text-[10px] text-white">
                  {pip.name}
                </span>
              </div>
            ) : null}
            {!expanded ? (
              <button
                type="button"
                onClick={toggleExpanded}
                title={t('fullscreen')}
                aria-label={t('fullscreen')}
                className="absolute right-2 top-2 rounded-md bg-black/60 p-1.5 text-white hover:bg-black/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
              >
                <Maximize className="h-4 w-4" />
              </button>
            ) : null}
          </div>
          {expanded ? (
            <div className="flex flex-wrap items-center justify-center gap-2 bg-neutral-950 px-3 py-3 sm:gap-3">
              {micBtn()}
              {camBtn()}
              {handBtn()}
              {fullBtn()}
              {leaveBtn()}
            </div>
          ) : null}
        </div>

        {/* Film strip: everyone; the speaker gets a green ring. */}
        <div className="flex gap-2 overflow-x-auto pb-1 [scrollbar-width:thin]">
          {tiles.map((tile) => (
            <Tile
              key={tile.id}
              tile={tile}
              speaking={speakingSet.has(tile.id)}
              pinned={pinnedId === tile.id}
              hostControls={amHost}
              onPin={() => setPinnedId((cur) => (cur === tile.id ? null : tile.id))}
              onMute={() => room.moderate(tile.id, 'mute')}
              onLowerHand={() => room.moderate(tile.id, 'lower-hand')}
              labels={tileLabels}
            />
          ))}
        </div>

        {errorText ? (
          <p className="text-xs text-red-300" role="alert">
            {errorText}
          </p>
        ) : null}

        <div className="flex flex-wrap items-center justify-center gap-2 sm:gap-3">
          {micBtn()}
          {camBtn()}
          <CtrlButton
            on={room.media.screen}
            label={room.media.screen ? t('stopShare') : t('share')}
            onClick={() => void room.toggleScreen()}
            className="hidden sm:inline-flex"
          >
            {room.media.screen ? <MonitorX /> : <MonitorUp />}
          </CtrlButton>
          {handBtn()}
          {amHost ? (
            <CtrlButton label={t('muteAll')} onClick={() => room.moderate('*', 'mute')}>
              <VolumeX />
            </CtrlButton>
          ) : null}
          {fullBtn()}
          {amHost && recordingSupported() ? (
            <button
              type="button"
              onClick={() => void (rec === 'on' ? stopRecording() : startRecording())}
              disabled={rec === 'starting' || rec === 'saving'}
              className={cn(
                'inline-flex h-11 shrink-0 items-center gap-2 rounded-full px-4 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/80 disabled:opacity-60 sm:h-12',
                rec === 'on'
                  ? 'bg-white text-red-600 hover:bg-white/90'
                  : 'bg-white/10 text-white hover:bg-white/20',
              )}
            >
              {rec === 'starting' || rec === 'saving' ? (
                <Spinner className="h-4 w-4" />
              ) : rec === 'on' ? (
                <Square className="h-4 w-4 fill-current" />
              ) : (
                <Circle className="h-4 w-4 fill-red-500 text-red-500" />
              )}
              {rec === 'saving'
                ? t('recSaving')
                : rec === 'on'
                  ? t('recStop')
                  : rec === 'starting'
                    ? t('recStarting')
                    : t('recStart')}
            </button>
          ) : null}
          <span className="mx-1 hidden h-6 w-px bg-white/15 sm:block" aria-hidden />
          {leaveBtn()}
        </div>
      </section>

      {floatingUi}

      {audioBlocked ? (
        <button
          type="button"
          onClick={unblockAudio}
          className="fixed left-1/2 top-4 z-[80] flex -translate-x-1/2 items-center gap-2 rounded-full bg-primary px-5 py-3 text-sm font-semibold text-primary-foreground shadow-2xl ring-4 ring-primary/20"
        >
          <VolumeX className="h-4 w-4" /> {t('enableSound')}
        </button>
      ) : null}

      {toastEl}
      {recResultEl}
    </>
  );
}
