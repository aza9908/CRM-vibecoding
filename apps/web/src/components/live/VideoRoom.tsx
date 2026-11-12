'use client';

import * as React from 'react';
import { useTranslations } from 'next-intl';
import {
  ArrowUpToLine,
  Hand,
  Mic,
  MicOff,
  Minimize2,
  MonitorUp,
  MonitorX,
  PhoneOff,
  Users,
  Video,
  VideoOff,
  VolumeX,
} from 'lucide-react';
import type { RtcMediaState } from '@lms/shared';
import { useVideoRoom, type RemotePeer } from '@/lib/rtc/useVideoRoom';
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

function Tile({
  tile,
  hostControls,
  onMute,
  onLowerHand,
  labels,
}: {
  tile: TileModel;
  hostControls: boolean;
  onMute: () => void;
  onLowerHand: () => void;
  labels: { you: string; host: string; mute: string; lowerHand: string };
}) {
  const showVideo = tile.media.video && !!tile.camera;
  return (
    <div
      className={cn(
        'group relative aspect-video w-full overflow-hidden rounded-lg bg-muted',
        tile.media.hand && 'ring-2 ring-warning',
      )}
    >
      {showVideo ? (
        <StreamVideo stream={tile.camera} mirror={tile.isSelf} />
      ) : (
        <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-primary/20 to-primary/5">
          <span className="-mt-4 flex h-7 w-7 items-center justify-center rounded-full bg-primary text-[11px] font-semibold text-primary-foreground sm:h-10 sm:w-10 sm:text-sm">
            {initials(tile.name)}
          </span>
        </div>
      )}
      <div className="absolute inset-x-0 bottom-0 flex items-center gap-1 bg-gradient-to-t from-black/70 to-transparent px-2 pb-1 pt-4 text-[11px] text-white">
        {tile.media.audio ? (
          <Mic className="h-3 w-3 shrink-0" aria-hidden />
        ) : (
          <MicOff className="h-3 w-3 shrink-0 text-destructive" aria-hidden />
        )}
        <span className="truncate">
          {tile.name}
          {!tile.isSelf && tile.isHost ? ` · ${labels.host}` : ''}
        </span>
        {tile.media.hand ? (
          <Hand className="ml-auto h-3.5 w-3.5 shrink-0 text-warning" aria-hidden />
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
              className="rounded bg-black/60 p-1 text-white hover:bg-black/80"
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
              className="rounded bg-black/60 p-1 text-white hover:bg-black/80"
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
      className="fixed inset-0 z-[60] flex items-center justify-center bg-foreground/50 p-4 backdrop-blur-sm"
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

/**
 * «Видеосвязь» — the meeting room of a live session, built into the LMS
 * (no Google Meet / Zoom needed). Teacher and students see and hear each
 * other, share screens, raise hands; the host can mute and lower hands.
 *
 * Docked at the top of the page. As soon as the panel scrolls out of view
 * it follows the user: a mini-window in the corner (video + main buttons),
 * which can be shrunk into a draggable round bubble. Scrolling back up (or
 * «Вернуться к видеосвязи») docks it again. Before joining, a round
 * «Видеосвязь» button stays in the corner instead.
 */
export function VideoRoom({
  sessionId,
  token,
  isHost,
  callState,
  autoJoin,
  className,
}: {
  sessionId: string | undefined;
  token: string | null | undefined;
  /** Teacher page: joins with camera + mic on. */
  isHost?: boolean;
  /** Live call state of the session (from the session socket). */
  callState?: { active: boolean; count: number; startedAt: string | null } | null;
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

  // The join window closes by itself once we are in the call.
  React.useEffect(() => {
    if (room.status === 'joined') setPreJoinOpen(false);
  }, [room.status]);
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

  const amHost = room.role === 'host';
  const joined = room.status === 'joined';

  // ── auto-join (students) ────────────────────────────────────────────────
  // When the teacher's call is running, students enter it automatically,
  // listen-only (no permission prompt). Leaving on purpose opts out of this
  // call; a new call (new startedAt) brings them in again.
  const optedOutOf = React.useRef<string | null>(null);
  const autoJoined = React.useRef(false);
  const callActive = !!callState?.active;
  const callKnown = callState != null;
  const callId = callState?.startedAt ?? null;
  const { join: joinCall, leave: leaveRoom, status: roomStatus } = room;
  React.useEffect(() => {
    if (!autoJoin || !callActive || !sessionId) return;
    if (roomStatus !== 'idle' || preJoinOpen) return;
    if (optedOutOf.current && optedOutOf.current === callId) return;
    // Spread 20+ students over ~3 s so the teacher's tab and the API are
    // not hit by every join in the same instant.
    const timer = window.setTimeout(() => {
      autoJoined.current = true;
      void joinCall({ audio: false, video: false });
    }, Math.random() * 3000);
    return () => window.clearTimeout(timer);
  }, [autoJoin, callActive, callId, sessionId, roomStatus, preJoinOpen, joinCall]);

  // The teacher ended the call → students drop out with a notice.
  React.useEffect(() => {
    if (!autoJoin || !callKnown || callActive || roomStatus !== 'joined') return;
    leaveRoom();
    showToast(t('callEnded'), 6000);
  }, [autoJoin, callKnown, callActive, roomStatus, leaveRoom, showToast, t]);

  const leaveCall = React.useCallback(() => {
    optedOutOf.current = callId;
    leaveRoom();
  }, [callId, leaveRoom]);

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

  const tiles = React.useMemo<TileModel[]>(() => {
    const self: TileModel = {
      id: room.selfId ?? 'self',
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
    // Hosts first, then raised hands, then people on camera.
    others.sort(
      (a, b) =>
        Number(b.isHost) - Number(a.isHost) ||
        Number(b.media.hand) - Number(a.media.hand) ||
        Number(b.media.video) - Number(a.media.video),
    );
    return [self, ...others];
  }, [room.selfId, room.media, room.localCamera, room.peers, amHost, t]);

  // Stage: a screen share wins, then the host's camera, then anyone on video.
  const stage = React.useMemo(() => {
    const sharer = room.peers.find((p) => p.media.screen && p.screen);
    if (sharer) {
      return { stream: sharer.screen, label: t('screenOf', { name: sharer.name }), fit: 'contain' as const, mirror: false };
    }
    if (room.media.screen && room.localScreen) {
      return { stream: room.localScreen, label: t('yourScreen'), fit: 'contain' as const, mirror: false };
    }
    const host = room.peers.find((p) => p.role === 'host' && p.media.video && p.camera);
    if (host) {
      return { stream: host.camera, label: host.name, fit: 'cover' as const, mirror: false };
    }
    const anyone = room.peers.find((p) => p.media.video && p.camera);
    if (anyone) {
      return { stream: anyone.camera, label: anyone.name, fit: 'cover' as const, mirror: false };
    }
    if (room.media.video && room.localCamera) {
      return { stream: room.localCamera, label: t('you'), fit: 'cover' as const, mirror: true };
    }
    return null;
  }, [room.peers, room.media, room.localScreen, room.localCamera, t]);

  const hands = room.peers.filter((p) => p.media.hand).length;
  const people = room.peers.length + 1;

  const errorText = room.error
    ? t.has(`errors.${room.error}`)
      ? t(`errors.${room.error}`)
      : t('errors.join_failed')
    : null;

  const tileLabels = {
    you: t('you'),
    host: t('host'),
    mute: t('mute'),
    lowerHand: t('lowerHand'),
  };

  // Shown in and out of the call (e.g. «Преподаватель завершил видеосвязь»).
  const toastEl = toast ? (
    <div
      role="status"
      className="fixed bottom-24 left-1/2 z-50 max-w-[calc(100vw-2rem)] -translate-x-1/2 rounded-md bg-foreground px-4 py-2 text-center text-sm text-background shadow-lg"
    >
      {toast}
    </div>
  ) : null;

  // ── not joined ──────────────────────────────────────────────────────────
  if (!joined) {
    const busy = room.status === 'joining';
    // Students wait for the teacher: joining an empty call makes no sense.
    const waiting = !!autoJoin && callKnown && !callActive;
    return (
      <>
        <section
          id="video-room"
          ref={dockRef}
          className={cn(
            'flex scroll-mt-28 flex-wrap items-center gap-3 rounded-lg border border-primary/30 bg-primary/5 p-4',
            className,
          )}
          aria-label={t('title')}
        >
          <span className="flex h-10 w-10 items-center justify-center rounded-full bg-primary text-primary-foreground">
            <Video className="h-5 w-5" aria-hidden />
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="text-sm font-semibold">{t('title')}</h2>
            <p className="text-xs text-muted-foreground">
              {busy
                ? t('connecting')
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
            {isHost ? t('startCall') : waiting ? t('waitingShort') : t('join')}
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
            {isHost ? t('startCall') : t('join')}
          </button>
        ) : null}
        {toastEl}
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
  const micBtn = (size: 'icon' | 'sm' = 'icon') => (
    <Button
      type="button"
      size={size}
      variant={room.media.audio ? 'secondary' : 'destructive'}
      onClick={() => void room.toggleAudio()}
      aria-pressed={room.media.audio}
      title={room.media.audio ? t('micOff') : t('micOn')}
      aria-label={room.media.audio ? t('micOff') : t('micOn')}
      className={size === 'sm' ? 'h-9 w-9 p-0' : undefined}
    >
      {room.media.audio ? <Mic className="h-4 w-4" /> : <MicOff className="h-4 w-4" />}
    </Button>
  );
  const camBtn = (size: 'icon' | 'sm' = 'icon') => (
    <Button
      type="button"
      size={size}
      variant={room.media.video ? 'secondary' : 'outline'}
      onClick={() => void room.toggleVideo()}
      aria-pressed={room.media.video}
      title={room.media.video ? t('camOff') : t('camOn')}
      aria-label={room.media.video ? t('camOff') : t('camOn')}
      className={size === 'sm' ? 'h-9 w-9 p-0' : undefined}
    >
      {room.media.video ? <Video className="h-4 w-4" /> : <VideoOff className="h-4 w-4" />}
    </Button>
  );
  const handBtn = (size: 'icon' | 'sm' = 'icon') => (
    <Button
      type="button"
      size={size}
      variant={room.media.hand ? 'default' : 'outline'}
      onClick={room.toggleHand}
      aria-pressed={room.media.hand}
      title={room.media.hand ? t('lowerMyHand') : t('raiseHand')}
      aria-label={room.media.hand ? t('lowerMyHand') : t('raiseHand')}
      className={cn(
        size === 'sm' && 'h-9 w-9 p-0',
        room.media.hand && 'bg-warning text-warning-foreground hover:bg-warning/90',
      )}
    >
      <Hand className="h-4 w-4" />
    </Button>
  );
  const leaveBtn = (size: 'icon' | 'sm' = 'icon') => (
    <Button
      type="button"
      size={size}
      variant="destructive"
      onClick={leaveCall}
      title={t('leave')}
      aria-label={t('leave')}
      className={size === 'sm' ? 'h-9 w-9 p-0' : undefined}
    >
      <PhoneOff className="h-4 w-4" />
    </Button>
  );

  const controls = (
    <div className="flex flex-wrap items-center justify-center gap-2">
      {micBtn()}
      {camBtn()}
      <Button
        type="button"
        size="icon"
        variant={room.media.screen ? 'default' : 'outline'}
        onClick={() => void room.toggleScreen()}
        aria-pressed={room.media.screen}
        title={room.media.screen ? t('stopShare') : t('share')}
        aria-label={room.media.screen ? t('stopShare') : t('share')}
        className="hidden sm:inline-flex"
      >
        {room.media.screen ? <MonitorX className="h-4 w-4" /> : <MonitorUp className="h-4 w-4" />}
      </Button>
      {handBtn()}
      {amHost ? (
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => room.moderate('*', 'mute')}
          title={t('muteAll')}
        >
          <VolumeX className="h-4 w-4" />
          <span className="hidden md:inline">{t('muteAll')}</span>
        </Button>
      ) : null}
      {leaveBtn()}
    </div>
  );

  const emptyStage = (compact: boolean) => (
    <div
      className={cn(
        'mx-auto flex w-full flex-col items-center justify-center gap-2 rounded-lg bg-muted text-center text-sm text-muted-foreground',
        compact ? 'aspect-video' : 'h-28 max-w-3xl',
      )}
    >
      <VideoOff className="h-6 w-6" aria-hidden />
      {t('nobodyOnCamera')}
    </div>
  );

  const stageView = (compact: boolean) =>
    stage ? (
      <div
        className={cn(
          'relative mx-auto aspect-video w-full overflow-hidden rounded-lg bg-black',
          !compact && 'max-w-3xl',
        )}
      >
        <StreamVideo stream={stage.stream} fit={stage.fit} mirror={stage.mirror} />
        <span className="absolute left-2 top-2 max-w-[80%] truncate rounded bg-black/60 px-2 py-0.5 text-xs text-white">
          {stage.label}
        </span>
      </div>
    ) : (
      emptyStage(compact)
    );

  const liveDot = (
    <span className="relative flex h-2.5 w-2.5 shrink-0">
      <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-success" />
    </span>
  );

  // Teacher: raised hands need attention → amber ring. Otherwise live green.
  const bubbleRing = amHost && hands > 0 ? 'bg-warning animate-pulse' : 'bg-success';
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

  const floatingUi = dockVisible ? null : floatMode === 'bubble' ? (
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
        'fixed bottom-4 z-40 transform-gpu w-[min(260px,calc(100vw-2rem))] space-y-2 rounded-xl border border-primary/30 bg-card p-2 shadow-2xl sm:w-[320px]',
        floatSide === 'right' ? 'right-4' : 'left-4',
      )}
      aria-label={t('title')}
    >
      <header className="flex items-center gap-2 px-1">
        {liveDot}
        <span className="min-w-0 flex-1 truncate text-xs font-semibold">
          {t('title')} · {t('people', { count: people })}
        </span>
        {hands > 0 ? (
          <span className="inline-flex items-center gap-1 rounded-full bg-warning/20 px-1.5 py-0.5 text-xs font-semibold">
            <Hand className="h-3.5 w-3.5" /> {hands}
          </span>
        ) : null}
        <button
          type="button"
          onClick={() => setFloatMode('bubble')}
          className="rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
          title={t('toBubble')}
          aria-label={t('toBubble')}
        >
          <Minimize2 className="h-4 w-4" />
        </button>
      </header>
      <button
        type="button"
        onClick={backToCall}
        className="block w-full"
        title={t('backToCall')}
        aria-label={t('backToCall')}
      >
        {stageView(true)}
      </button>
      <div className="flex items-center justify-between gap-1.5">
        <div className="flex gap-1.5">
          {micBtn('sm')}
          {camBtn('sm')}
          {handBtn('sm')}
        </div>
        <div className="flex gap-1.5">
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={backToCall}
            className="h-9 gap-1 px-2.5"
            title={t('backToCall')}
            aria-label={t('backToCall')}
          >
            <ArrowUpToLine className="h-4 w-4" />
            <span className="hidden text-xs sm:inline">{t('backShort')}</span>
          </Button>
          {leaveBtn('sm')}
        </div>
      </div>
    </section>
  );

  return (
    <>
      {/* Audio for every remote peer, independent of the visible layout. */}
      {room.peers.map((p) => (
        <PeerAudio key={p.peerId} stream={p.camera} onBlocked={onAudioBlocked} />
      ))}

      <section
        id="video-room"
        ref={dockRef}
        className={cn('scroll-mt-28 space-y-3 rounded-lg border border-primary/30 bg-card p-3 shadow-sm', className)}
        aria-label={t('title')}
      >
        <header className="flex flex-wrap items-center gap-2">
          {liveDot}
          <h2 className="text-sm font-semibold">{t('title')}</h2>
          <span className="rounded-full bg-success/15 px-2 py-0.5 text-xs font-semibold text-success">
            {t('inCall')}
          </span>
          <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
            <Users className="h-3.5 w-3.5" /> {t('people', { count: people })}
          </span>
          {hands > 0 ? (
            <span className="inline-flex items-center gap-1 rounded-full bg-warning/20 px-2 py-0.5 text-xs font-medium text-foreground">
              <Hand className="h-3.5 w-3.5" /> {t('hands', { count: hands })}
            </span>
          ) : null}
          <span className="ml-auto hidden text-xs text-muted-foreground md:inline">
            {t('scrollHint')}
          </span>
        </header>

        {stageView(false)}

        <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 lg:grid-cols-6">
          {tiles.map((tile) => (
            <Tile
              key={tile.id}
              tile={tile}
              hostControls={amHost}
              onMute={() => room.moderate(tile.id, 'mute')}
              onLowerHand={() => room.moderate(tile.id, 'lower-hand')}
              labels={tileLabels}
            />
          ))}
        </div>

        {errorText ? (
          <p className="text-xs text-destructive" role="alert">
            {errorText}
          </p>
        ) : null}
        {controls}
      </section>

      {floatingUi}

      {audioBlocked ? (
        <button
          type="button"
          onClick={unblockAudio}
          className="fixed left-1/2 top-4 z-50 flex -translate-x-1/2 items-center gap-2 rounded-full bg-primary px-5 py-3 text-sm font-semibold text-primary-foreground shadow-2xl ring-4 ring-primary/20"
        >
          <VolumeX className="h-4 w-4" /> {t('enableSound')}
        </button>
      ) : null}

      {toastEl}
    </>
  );
}
