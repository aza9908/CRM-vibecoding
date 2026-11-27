'use client';

import * as React from 'react';
import { useLocale, useTranslations } from 'next-intl';
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
  SmilePlus,
  Sparkles,
  Square,
  Users,
  Video,
  VideoOff,
  VolumeX,
  X,
} from 'lucide-react';
import { RTC_REACTIONS, type RtcMediaState, type RtcReactionRelay } from '@lms/shared';
import {
  readCallResume,
  screenShareSupported,
  useVideoRoom,
  type RemotePeer,
} from '@/lib/rtc/useVideoRoom';
import { BackgroundPicker, currentBackground } from '@/components/live/BackgroundPicker';
import { readBackgroundImage } from '@/lib/rtc/backgroundBlur';
import { serverRecordings } from '@/lib/api/recordings';
import { ServerRecordings, watchServerRecording } from '@/components/live/ServerRecordings';
import {
  discardSavedRecording,
  googleClientId,
  listUnfinishedRecordings,
  recordingSupported,
  recoverRecording,
  requestGoogleToken,
  startCallRecording,
  type CallRecorder,
  type RecordingResult,
  type RecordingTarget,
  type SavedRecording,
} from '@/lib/rtc/recorder';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { cn } from '@/lib/utils';
import { useAuthStore } from '@/lib/store/auth-store';
import { createAnalysisAudioSink } from '@/lib/api/lesson-analysis';
import { startBackgroundBlur, type BlurPipeline } from '@/lib/rtc/backgroundBlur';
import { DiagChannel } from '@/lib/ws/diag-channel';
import { CoachButton, CoachPanel, useCoachIssues } from '@/components/live/CoachPanel';

/** Stand-in when the page gives no «Помощник тренера» channel (students). */
const NO_DIAG = new DiagChannel();

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
  /** Connection dropped; their place is kept while they come back. */
  away?: boolean;
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
  subscribeReactions,
}: {
  tile: TileModel;
  speaking: boolean;
  pinned: boolean;
  hostControls: boolean;
  onPin: () => void;
  onMute: () => void;
  onLowerHand: () => void;
  labels: { host: string; mute: string; lowerHand: string; pin: string; unpin: string; speaking: string; away: string };
  /** Pops this person's emoji reactions on the tile. */
  subscribeReactions?: SubscribeReactions;
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
      {subscribeReactions ? (
        <TileReaction peerId={tile.id} subscribe={subscribeReactions} />
      ) : null}
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
        {tile.away ? (
          <span className="shrink-0 rounded bg-black/60 px-1 text-[10px] text-amber-300">{labels.away}</span>
        ) : null}
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
  blur,
  onBlurChange,
  onJoin,
  onClose,
}: {
  isHost: boolean;
  busy: boolean;
  errorText: string | null;
  /** «Размыть фон»: can this browser do it, and the remembered choice. */
  blur: { supported: boolean; on: boolean };
  onBlurChange: (on: boolean) => void;
  onJoin: (audio: boolean, video: boolean) => void;
  onClose: () => void;
}) {
  const t = useTranslations('videoRoom');
  const [mic, setMic] = React.useState(isHost);
  const [cam, setCam] = React.useState(isHost);
  const [preview, setPreview] = React.useState<MediaStream | null>(null);
  const [previewError, setPreviewError] = React.useState(false);
  const previewRef = React.useRef<MediaStream | null>(null);
  // The preview shows the blurred picture when blur is on.
  const [blurred, setBlurred] = React.useState<MediaStream | null>(null);
  const [blurBusy, setBlurBusy] = React.useState(false);
  const [blurBroken, setBlurBroken] = React.useState(false);
  const blurOn = blur.on && blur.supported && !blurBroken;
  React.useEffect(() => {
    const track = preview?.getVideoTracks()[0];
    if (!track || !blurOn) {
      setBlurred(null);
      return;
    }
    let cancelled = false;
    let pipe: BlurPipeline | null = null;
    setBlurBusy(true);
    startBackgroundBlur(track, () => {
      if (!cancelled) setBlurred(null);
    })
      .then((p) => {
        if (cancelled) {
          p.stop();
          return;
        }
        pipe = p;
        setBlurred(new MediaStream([p.output]));
      })
      .catch(() => {
        if (!cancelled) setBlurBroken(true);
      })
      .finally(() => {
        if (!cancelled) setBlurBusy(false);
      });
    return () => {
      cancelled = true;
      pipe?.stop();
      setBlurred(null);
      setBlurBusy(false);
    };
  }, [preview, blurOn]);

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
            <StreamVideo stream={blurred ?? preview} mirror />
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

        {cam && preview && blur.supported && !blurBroken ? (
          <div className="space-y-1.5" data-testid="prejoin-blur">
            <p className="flex items-center gap-2 text-sm font-medium">
              {t('bgTitle')} {blurBusy ? <Spinner className="h-3.5 w-3.5" /> : null}
            </p>
            <BackgroundPicker
              value={blur.on ? (readBackgroundImage() ?? 'blur') : 'none'}
              setEffect={onBlurChange}
              disabled={busy}
            />
          </div>
        ) : null}

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

type SubscribeReactions = (cb: (r: RtcReactionRelay) => void) => () => void;

/** At most this many emoji float at once — keeps a class of 50+ smooth. */
const MAX_FLOATING_REACTIONS = 25;
const FLOAT_MS = 3300;

interface FloatingReaction {
  id: number;
  emoji: string;
  name: string;
  /** Horizontal start, % of the stage width. */
  left: number;
  /** Sideways sway, px. */
  drift: number;
}

/**
 * Emoji reactions floating up over the stage. Owns its state, so a burst of
 * reactions re-renders only this layer, not the whole call.
 */
const ReactionLayer = React.memo(function ReactionLayer({
  subscribe,
  selfId,
  youLabel,
}: {
  subscribe: SubscribeReactions;
  selfId: string | null;
  youLabel: string;
}) {
  const [items, setItems] = React.useState<FloatingReaction[]>([]);
  const seq = React.useRef(0);
  const timers = React.useRef(new Set<number>());
  const selfRef = React.useRef(selfId);
  selfRef.current = selfId;
  const youRef = React.useRef(youLabel);
  youRef.current = youLabel;

  React.useEffect(() => {
    const live = timers.current;
    const off = subscribe((r) => {
      const id = ++seq.current;
      const item: FloatingReaction = {
        id,
        emoji: r.emoji,
        name: r.peerId === selfRef.current ? youRef.current : r.name,
        left: 8 + Math.random() * 76,
        drift: Math.round((Math.random() - 0.5) * 40),
      };
      setItems((prev) => {
        const next = [...prev, item];
        return next.length > MAX_FLOATING_REACTIONS
          ? next.slice(next.length - MAX_FLOATING_REACTIONS)
          : next;
      });
      const timer = window.setTimeout(() => {
        live.delete(timer);
        setItems((prev) => prev.filter((x) => x.id !== id));
      }, FLOAT_MS);
      live.add(timer);
    });
    return () => {
      off();
      for (const timer of live) window.clearTimeout(timer);
      live.clear();
    };
  }, [subscribe]);

  if (items.length === 0) return null;
  return (
    <div className="pointer-events-none absolute inset-0 z-[5] overflow-hidden" aria-hidden>
      {items.map((it) => (
        <span
          key={it.id}
          className="call-reaction absolute bottom-[12%] flex flex-col items-center gap-0.5"
          style={
            { left: `${it.left}%`, '--reaction-drift': `${it.drift}px` } as React.CSSProperties
          }
        >
          <span className="text-3xl leading-none drop-shadow-[0_2px_4px_rgba(0,0,0,0.5)] sm:text-4xl">
            {it.emoji}
          </span>
          <span className="max-w-[9rem] truncate rounded-full bg-black/60 px-2 py-0.5 text-[11px] font-medium text-white">
            {it.name}
          </span>
        </span>
      ))}
    </div>
  );
});

/** The latest reaction of one person, popped briefly on their tile. */
function TileReaction({ peerId, subscribe }: { peerId: string; subscribe: SubscribeReactions }) {
  const [shown, setShown] = React.useState<{ emoji: string; key: number } | null>(null);
  React.useEffect(() => {
    let timer: number | null = null;
    const off = subscribe((r) => {
      if (r.peerId !== peerId) return;
      setShown({ emoji: r.emoji, key: Date.now() });
      if (timer) window.clearTimeout(timer);
      timer = window.setTimeout(() => setShown(null), 2600);
    });
    return () => {
      off();
      if (timer) window.clearTimeout(timer);
    };
  }, [peerId, subscribe]);
  if (!shown) return null;
  return (
    <span
      key={shown.key}
      aria-hidden
      className="call-reaction-badge pointer-events-none absolute left-1.5 top-1.5 z-[1] flex h-8 w-8 items-center justify-center rounded-full bg-black/55 text-lg leading-none"
    >
      {shown.emoji}
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
  caption,
}: {
  /** Short visible word under the button (big bars only), e.g. «Камера». */
  caption?: string;
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
  const button = (
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
  if (!caption || compact) return button;
  return (
    <span className="inline-flex shrink-0 flex-col items-center gap-1">
      {button}
      <span className="hidden text-[11px] leading-none text-white/75 sm:block">{caption}</span>
    </span>
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
  coach,
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
  /** Teacher page: «Помощник тренера» — participants' technical problems. */
  coach?: DiagChannel;
  className?: string;
}) {
  const t = useTranslations('videoRoom');
  const locale = useLocale();
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

  // Screen sharing failed for a reason the user can act on (a cancelled
  // picker is not reported by the hook).
  React.useEffect(() => {
    if (!room.screenError) return;
    const key = {
      unsupported: 'shareUnsupported',
      os_denied_mac: 'shareOsDeniedMac',
      denied: 'shareDenied',
      failed: 'shareFailed',
    }[room.screenError.code];
    showToast(t(key), 9000);
  }, [room.screenError, showToast, t]);

  // Background blur stopped by itself (too slow / not supported / error).
  React.useEffect(() => {
    if (!room.blurError) return;
    const key = {
      slow: 'blurSlow',
      unsupported: 'blurUnsupported',
      failed: 'blurFailed',
    }[room.blurError.code];
    showToast(t(key), 8000);
  }, [room.blurError, showToast, t]);

  // A hint for me: a teacher sent a ready fix, or my own browser noticed
  // something (e.g. talking with the mic off). Never someone else's problem.
  const tc = useTranslations('videoRoom.coach');
  React.useEffect(() => {
    const h = room.diagHint;
    if (!h) return;
    const text = tc(`fix.${h.kind}`);
    showToast(
      h.from === null ? text : h.from ? tc('hintFrom', { name: h.from, text }) : tc('hintFromAnon', { text }),
      12000,
    );
  }, [room.diagHint, showToast, tc]);

  // «Помощник тренера» (teacher page only).
  const coachIssues = useCoachIssues(coach ?? NO_DIAG, room.selfId);
  const [coachOpen, setCoachOpen] = React.useState<'dock' | 'full' | null>(null);
  React.useEffect(() => {
    if (!coachOpen) return;
    const onDown = (e: PointerEvent) => {
      const el = e.target as Element | null;
      if (!el?.closest?.('[data-coach-menu]')) setCoachOpen(null);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setCoachOpen(null);
    };
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [coachOpen]);
  // A quiet toast when new problems appear: grouped, at most one per 10 s.
  const selfIdRef = React.useRef(room.selfId);
  selfIdRef.current = room.selfId;
  const coachOpenRef = React.useRef(coachOpen);
  coachOpenRef.current = coachOpen;
  React.useEffect(() => {
    if (!coach) return;
    let pending: { name: string; kind: string }[] = [];
    let last = 0;
    let timer: number | null = null;
    const flush = () => {
      timer = null;
      const batch = pending;
      pending = [];
      if (!batch.length || coachOpenRef.current) return;
      last = Date.now();
      const first = batch[0]!;
      showToast(
        batch.length === 1
          ? tc('newIssue', { name: first.name, problem: tc(`kinds.${first.kind}`) })
          : tc('newIssues', { count: batch.length }),
        6000,
      );
    };
    const off = coach.onNewIssue((issue) => {
      if (issue.peerId === selfIdRef.current) return;
      pending.push({ name: issue.name, kind: issue.kind });
      if (timer == null) timer = window.setTimeout(flush, Math.max(1500, last + 10_000 - Date.now()));
    });
    return () => {
      off();
      if (timer != null) window.clearTimeout(timer);
    };
  }, [coach, showToast, tc]);

  // Emoji reactions picker — one per control bar (docked / full screen).
  const [reactMenu, setReactMenu] = React.useState<'dock' | 'full' | null>(null);
  const [bgMenu, setBgMenu] = React.useState(false);
  React.useEffect(() => {
    if (!bgMenu) return;
    const onDown = (e: PointerEvent) => {
      const el = e.target as Element | null;
      if (!el?.closest?.('[data-bg-menu]')) setBgMenu(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setBgMenu(false);
    };
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [bgMenu]);
  React.useEffect(() => {
    if (!reactMenu) return;
    const onDown = (e: PointerEvent) => {
      const el = e.target as Element | null;
      if (!el?.closest?.('[data-react-menu]')) setReactMenu(null);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setReactMenu(null);
    };
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [reactMenu]);

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
  // «Помощник тренера»: the teacher sees who cannot hear the lesson.
  const { reportDiag } = room;
  React.useEffect(() => {
    if (!joined) return;
    reportDiag('audio_blocked', audioBlocked);
  }, [joined, audioBlocked, reportDiag]);
  // Any click on the page counts as the gesture browsers want for sound.
  React.useEffect(() => {
    if (!audioBlocked) return;
    const onDown = () => unblockAudio();
    document.addEventListener('pointerdown', onDown, { once: true });
    return () => document.removeEventListener('pointerdown', onDown);
  }, [audioBlocked, unblockAudio]);

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
      away: !!p.away,
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
  const [recMenu, setRecMenu] = React.useState(false);
  const [recProgress, setRecProgress] = React.useState<number | null>(null);
  const [recTarget, setRecTarget] = React.useState<RecordingTarget>('download');
  const { setRecording: announceRecording } = room;

  // Recordings left unfinished by a crash, a power cut or a closed tab.
  const [orphans, setOrphans] = React.useState<SavedRecording[]>([]);
  const [recovering, setRecovering] = React.useState<string | null>(null);
  React.useEffect(() => {
    if (!isHost) return;
    let alive = true;
    const check = () =>
      void listUnfinishedRecordings().then((list) => {
        if (alive) setOrphans(list);
      });
    check();
    // A recording interrupted seconds ago only counts as abandoned after a
    // short while, so look again.
    const id = window.setInterval(check, 12_000);
    return () => {
      alive = false;
      window.clearInterval(id);
    };
  }, [isHost]);
  const recoverOrphan = React.useCallback(async (rec: SavedRecording) => {
    setRecovering(rec.recId);
    setRecProgress(0);
    try {
      // YouTube wants the Google sign-in on every request of the upload.
      let auth: string | null = null;
      const clientId = googleClientId();
      if (rec.streamOnly && rec.target === 'youtube' && clientId) {
        auth = await requestGoogleToken(clientId, 'youtube', useAuthStore.getState().user?.email).catch(
          () => null,
        );
      }
      setRecResult(await recoverRecording(rec, setRecProgress, auth));
    } finally {
      setRecovering(null);
      setRecProgress(null);
      setOrphans((list) => list.filter((r) => r.recId !== rec.recId));
    }
  }, []);
  const discardOrphan = React.useCallback(async (rec: SavedRecording) => {
    await discardSavedRecording(rec.recId);
    setOrphans((list) => list.filter((r) => r.recId !== rec.recId));
  }, []);

  /** Google permission from the start of a YouTube / Drive recording. */
  const googleTokenRef = React.useRef<{ token: string; at: number; target: 'youtube' | 'drive' } | null>(null);
  const stopRecording = React.useCallback(async () => {
    const recorder = recorderRef.current;
    if (!recorder) return;
    recorderRef.current = null;
    setRec('saving');
    announceRecording(false);
    try {
      const result = await recorder.stop(setRecProgress);
      if (result.serverRecordingId) {
        // YouTube / Drive via the LMS server: the server sends it with the
        // Google permission given at the start while it is still fresh
        // (Google's tokens last an hour); otherwise «Отправить» in the list.
        const id = result.serverRecordingId;
        watchServerRecording(id);
        const g = googleTokenRef.current;
        let sending = false;
        if (g && g.target === result.where && Date.now() - g.at < 50 * 60_000) {
          sending = await serverRecordings
            .send(id, g.target, g.token)
            .then(() => true)
            .catch(() => false);
        }
        googleTokenRef.current = null;
        window.dispatchEvent(new Event('lms-recordings-changed'));
        setRecResult({ ...result, serverSending: sending });
      } else {
        setRecResult(result);
      }
    } finally {
      setRec('idle');
      setRecProgress(null);
    }
  }, [announceRecording]);

  const startRecording = React.useCallback(
    async (target: RecordingTarget) => {
      if (recorderRef.current || rec !== 'idle') return;
      setRecMenu(false);
      setRecResult(null);
      setRec('starting');
      try {
        window.localStorage.setItem('lms-rec-target', target);
      } catch {
        /* preference only */
      }
      let token: string | null = null;
      const clientId = googleClientId();
      if (target !== 'download' && clientId) {
        // Opens Google's window; must run inside this click.
        token = await requestGoogleToken(
          clientId,
          target,
          useAuthStore.getState().user?.email,
        ).catch(() => null);
        // Without a server copy (no session) Drive needs the permission now.
        if (!token && target === 'drive' && !sessionId) showToast(t('recDriveDenied'), 7000);
      }
      googleTokenRef.current =
        token && target !== 'download' ? { token, at: Date.now(), target } : null;
      try {
        const recorder = await startCallRecording({
          title: recordingTitle || t('recDefaultTitle'),
          target,
          token,
          // YouTube / Drive: the video streams to the LMS server, which
          // sends the finished file (nothing is kept on this computer; a
          // dropped connection or a host who leaves loses nothing — a
          // colleague can send it or record «часть 2»).
          relay:
            target !== 'download' && sessionId
              ? {
                  create: async (title, mimeType) => {
                    const created = await serverRecordings.create(sessionId, title, mimeType, target);
                    if (created.part > 1) showToast(t('recContinuation', { n: created.part }), 9000);
                    return created;
                  },
                  putPiece: (id, offset, piece) => serverRecordings.putPiece(id, offset, piece),
                  complete: (id) => serverRecordings.complete(id),
                  continueAfter: async (id) => {
                    const next = await serverRecordings.continueAfter(id);
                    watchServerRecording(next.id);
                    showToast(t('recContinuation', { n: next.part }), 9000);
                    return next;
                  },
                }
              : null,
          // A light audio copy goes to the server for the AI lesson review.
          audioSink: (mimeType) =>
            sessionId
              ? createAnalysisAudioSink({
                  sessionId,
                  title: recordingTitle || t('recDefaultTitle'),
                  mimeType,
                  locale,
                })
              : null,
        });
        recorder.onError = (message) => {
          // The internet is down: the video waits in memory and goes up
          // when it is back — keep recording.
          if (message === 'upload_backlog') {
            showToast(t('recBacklog'), 9000);
            return;
          }
          if (message === 'stream_refused') showToast(t('recStreamRefused'), 12000);
          void stopRecording();
        };
        recorderRef.current = recorder;
        setRecTarget(recorder.target);
        setRecSince(Date.now());
        setRec('on');
        announceRecording(true);
        if (target !== 'download' && recorder.target === 'download') showToast(t('recCloudFailed'), 7000);
      } catch {
        setRec('idle');
        showToast(t('recFailed'), 6000);
      }
    },
    [rec, recordingTitle, announceRecording, showToast, stopRecording, t, sessionId, locale],
  );
  React.useEffect(() => {
    if (!recMenu && !leaveMenu) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      setRecMenu(false);
      setLeaveMenu(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [recMenu, leaveMenu]);
  const lastRecTarget = React.useMemo<RecordingTarget>(() => {
    try {
      const v = window.localStorage.getItem('lms-rec-target');
      if (v === 'youtube' || v === 'drive' || v === 'download') return v;
    } catch {
      /* default below */
    }
    return googleClientId() ? 'youtube' : 'download';
  }, []);

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

  // Back in the call after a drop: the server forgot who records (it ended
  // with the old connection) — mark it again so everyone sees «REC».
  React.useEffect(() => {
    if (room.status === 'joined' && rec === 'on') announceRecording(true);
  }, [room.status, rec, announceRecording]);

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
    away: t('peerAway'),
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

  // A recording that never got finished (crash / power cut): offer to save it.
  const serverRecEl = isHost ? <ServerRecordings /> : null;
  const orphanEl =
    isHost && orphans.length > 0 && rec === 'idle' ? (
      <div
        role="alert"
        className="flex flex-wrap items-center gap-3 rounded-xl border border-warning/50 bg-warning/10 p-4 text-sm"
      >
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-warning text-warning-foreground">
          <Circle className="h-3.5 w-3.5 fill-current" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="font-semibold">{t('recOrphanTitle')}</p>
          <p className="truncate text-xs text-muted-foreground">
            {orphans[0]!.fileName} · {Math.max(1, Math.round(orphans[0]!.bytes / 1048576))} МБ
          </p>
        </div>
        <Button
          type="button"
          size="sm"
          onClick={() => void recoverOrphan(orphans[0]!)}
          disabled={recovering != null}
        >
          {recovering ? <Spinner className="h-4 w-4" /> : null}
          {recovering && recProgress != null
            ? t('recSavingPct', { pct: Math.round(recProgress * 100) })
            : t('recOrphanSave')}
        </Button>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          onClick={() => void discardOrphan(orphans[0]!)}
          disabled={recovering != null}
        >
          {t('recOrphanDiscard')}
        </Button>
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
          {recResult.serverRecordingId
            ? recResult.serverSending
              ? recResult.where === 'drive'
                ? t('recSendingDrive')
                : t('recSendingYoutube')
              : t('recServerSaved')
            : recResult.where !== 'download' && !recResult.link && recResult.cloudError
            ? recResult.cloudError === 'offline'
              ? t('recPending')
              : t('recNotSaved')
            : recResult.where === 'youtube'
            ? t('recSavedYoutube')
            : recResult.where === 'drive'
              ? t('recSavedDrive')
              : t('recSavedDownload')}
        </p>
        <p className="truncate text-xs text-muted-foreground">{recResult.fileName}</p>
        {recResult.serverRecordingId ? (
          <p className="mt-1 text-xs text-muted-foreground">
            {recResult.serverSending
              ? t('recSendingHint')
              : recResult.where === 'drive'
                ? t('recServerHintDrive')
                : t('recServerHint')}
          </p>
        ) : recResult.where !== 'download' && recResult.link ? (
          <>
            <a
              href={recResult.link}
              target="_blank"
              rel="noreferrer"
              className="mt-1 inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline"
            >
              {recResult.where === 'youtube' ? t('recOpenYoutube') : t('recOpenDrive')}{' '}
              <ExternalLink className="h-3.5 w-3.5" />
            </a>
            {recResult.where === 'youtube' ? (
              <p className="mt-1 text-xs text-muted-foreground">
                {recResult.privacy === 'private' ? t('recYoutubePrivate') : t('recYoutubeUnlisted')}
              </p>
            ) : null}
            {recResult.cloudError === 'partial' ? (
              <p className="mt-1 text-xs text-muted-foreground">{t('recPartial')}</p>
            ) : null}
          </>
        ) : recResult.where !== 'download' && recResult.cloudError ? (
          <p className="mt-1 text-xs text-muted-foreground">
            {recResult.cloudError === 'offline' ? t('recPendingHint') : t('recNotSavedHint')}
          </p>
        ) : recResult.cloudError ? (
          <p className="mt-1 text-xs text-muted-foreground">{t('recDriveFallback')}</p>
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
        {orphanEl}
        {serverRecEl}
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
            blur={{ supported: room.blur.supported, on: room.blur.on }}
            onBlurChange={room.setBlur}
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
      caption={t('capMic')}
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
      caption={t('capCam')}
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
      caption={t('capHand')}
      accent={room.media.hand}
      label={room.media.hand ? t('lowerMyHand') : t('raiseHand')}
      onClick={room.toggleHand}
    >
      <Hand />
    </CtrlButton>
  );
  // «Размыть фон»: shown while the camera is on (or blur is wanted). A
  // browser that cannot do it gets a dimmed button that says so.
  const blurBtn = (compact = false) =>
    !room.media.video && !room.blur.on ? null : room.blur.supported ? (
      <span className="relative" data-bg-menu>
        <CtrlButton
          compact={compact}
      caption={t('capBg')}
          on={bgMenu}
          label={room.blur.busy ? t('blurLoading') : t('bgTitle')}
          onClick={() => setBgMenu((v) => !v)}
          className={room.blur.busy ? 'animate-pulse' : undefined}
        >
          {room.blur.busy ? <Spinner className="h-4 w-4" /> : <Sparkles />}
        </CtrlButton>
        {bgMenu ? (
          <span className="absolute bottom-full left-1/2 z-30 mb-2 w-[17rem] -translate-x-1/2 rounded-2xl border border-white/10 bg-neutral-900/95 p-3 shadow-2xl">
            <span className="mb-2 block text-xs font-medium text-white/80">{t('bgTitle')}</span>
            <BackgroundPicker
              dark
              value={currentBackground(room.blur.on)}
              setEffect={room.setBlur}
              onPicked={() => setBgMenu(false)}
            />
          </span>
        ) : null}
      </span>
    ) : (
      <CtrlButton
        compact={compact}
        label={t('blurUnsupported')}
        onClick={() => showToast(t('blurUnsupported'), 8000)}
        className="opacity-50"
      >
        <Sparkles />
      </CtrlButton>
    );
  const coachBtn = (where: 'dock' | 'full') =>
    coach ? (
      <span className="relative" data-coach-menu>
        <CoachButton
          count={coachIssues.length}
          open={coachOpen === where}
          onClick={() => setCoachOpen((cur) => (cur === where ? null : where))}
        />
        {coachOpen === where ? (
          <CoachPanel
            diag={coach}
            issues={coachIssues}
            onClose={() => setCoachOpen(null)}
            className={cn(
              'absolute right-0 sm:left-1/2 sm:right-auto sm:-translate-x-1/2',
              // Docked bar: open downwards (above it are the sticky page
              // header and the stage); full screen: upwards from the bottom bar.
              where === 'dock' ? 'top-full mt-2' : 'bottom-full mb-2',
            )}
          />
        ) : null}
      </span>
    ) : null;
  // Offered wherever getDisplayMedia exists (no UA sniffing). Phones and old
  // browsers get a dimmed button that explains where sharing works.
  const canShare = screenShareSupported();
  const shareBtn = (compact = false) =>
    canShare ? (
      <CtrlButton
        compact={compact}
      caption={t('capShare')}
        on={room.media.screen}
        label={room.media.screen ? t('stopShare') : t('share')}
        onClick={() => void room.toggleScreen()}
      >
        {room.media.screen ? <MonitorX /> : <MonitorUp />}
      </CtrlButton>
    ) : (
      <CtrlButton
        compact={compact}
        label={t('shareUnsupported')}
        onClick={() => showToast(t('shareUnsupported'), 9000)}
        className="opacity-50"
      >
        <MonitorUp />
      </CtrlButton>
    );
  const reactBtn = (where: 'dock' | 'full') => (
    <span className="relative" data-react-menu>
      <CtrlButton
        caption={t('capReact')}
        on={reactMenu === where}
        label={t('react')}
        onClick={() => setReactMenu((cur) => (cur === where ? null : where))}
      >
        <SmilePlus />
      </CtrlButton>
      {reactMenu === where ? (
        <span
          role="menu"
          aria-label={t('react')}
          className="absolute bottom-full left-1/2 z-20 mb-2 grid -translate-x-1/2 grid-cols-4 gap-0.5 rounded-2xl border border-white/10 bg-neutral-900/95 p-1 shadow-2xl sm:flex sm:rounded-full"
        >
          {RTC_REACTIONS.map((emoji) => (
            <button
              key={emoji}
              type="button"
              role="menuitem"
              onClick={() => room.sendReaction(emoji)}
              title={t('reactSend', { emoji })}
              aria-label={t('reactSend', { emoji })}
              className="flex h-10 w-10 items-center justify-center rounded-full text-2xl leading-none transition-transform hover:scale-125 hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/80 motion-reduce:transition-none motion-reduce:hover:scale-100"
            >
              {emoji}
            </button>
          ))}
        </span>
      ) : null}
    </span>
  );
  const fullBtn = (compact = false) => (
    <CtrlButton
      compact={compact}
      caption={t('capFull')}
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
                <span className={cn('truncate', tile.away && 'text-amber-300')}>{tile.name}</span>
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

      {orphanEl}
      {serverRecEl}
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
              {rec === 'on' && recTarget !== 'download' ? (
                <span className="font-normal opacity-90">
                  → {recTarget === 'youtube' ? 'YouTube' : 'Drive'}
                </span>
              ) : null}
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
            <ReactionLayer
              subscribe={room.subscribeReactions}
              selfId={room.selfId}
              youLabel={t('you')}
            />
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
              {blurBtn()}
              {shareBtn()}
              {handBtn()}
              {reactBtn('full')}
              {coachBtn('full')}
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
              subscribeReactions={room.subscribeReactions}
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
          {blurBtn()}
          {shareBtn()}
          {handBtn()}
          {reactBtn('dock')}
          {coachBtn('dock')}
          {amHost ? (
            <button
              type="button"
              onClick={() => {
                room.moderate('*', 'mute');
                showToast(
                  room.peers.some((p) => p.media.audio) ? t('mutedAllDone') : t('mutedAllNobody'),
                );
              }}
              title={t('muteAll')}
              className="inline-flex h-11 shrink-0 items-center gap-2 rounded-full bg-white/10 px-4 text-sm font-semibold text-white transition-colors hover:bg-white/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/80 sm:h-12"
            >
              <MicOff className="h-4 w-4" />
              <span className="hidden md:inline">{t('muteAllShort')}</span>
            </button>
          ) : null}
          {fullBtn()}
          {amHost && recordingSupported() ? (
            <span className="relative">
              <button
                type="button"
                onClick={() =>
                  rec === 'on' ? void stopRecording() : setRecMenu((v) => !v)
                }
                disabled={rec === 'starting' || rec === 'saving'}
                aria-haspopup={rec === 'on' ? undefined : 'menu'}
                aria-expanded={rec === 'on' ? undefined : recMenu}
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
                  ? recProgress != null
                    ? t('recSavingPct', { pct: Math.round(recProgress * 100) })
                    : t('recSaving')
                  : rec === 'on'
                    ? t('recStop')
                    : rec === 'starting'
                      ? t('recStarting')
                      : t('recStart')}
              </button>
              {recMenu && rec === 'idle' ? (
                <span
                  role="menu"
                  aria-label={t('recWhere')}
                  className="absolute bottom-full left-1/2 z-10 mb-2 flex w-72 -translate-x-1/2 flex-col gap-1 rounded-xl border bg-card p-1.5 text-left text-foreground shadow-2xl"
                >
                  <span className="px-3 pb-1 pt-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    {t('recWhere')}
                  </span>
                  {(
                    [
                      ['youtube', t('recToYoutube'), t('recToYoutubeHint')],
                      ['drive', t('recToDrive'), t('recToDriveHint')],
                      ['download', t('recToComputer'), t('recToComputerHint')],
                    ] as [RecordingTarget, string, string][]
                  )
                    .filter(([target]) => target === 'download' || !!googleClientId())
                    .map(([target, label, hint]) => (
                      <button
                        key={target}
                        type="button"
                        role="menuitem"
                        onClick={() => void startRecording(target)}
                        className={cn(
                          'rounded-lg px-3 py-2 text-left hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                          target === lastRecTarget && 'bg-primary/5 ring-1 ring-primary/30',
                        )}
                      >
                        <span className="block text-sm font-semibold">{label}</span>
                        <span className="block text-xs text-muted-foreground">{hint}</span>
                      </button>
                    ))}
                  <span className="px-3 pb-1.5 pt-1 text-[11px] leading-snug text-muted-foreground">
                    {t('recSafeHint')}
                  </span>
                </span>
              ) : null}
            </span>
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
