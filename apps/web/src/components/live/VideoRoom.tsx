'use client';

import * as React from 'react';
import { useTranslations } from 'next-intl';
import {
  Hand,
  Maximize2,
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
function PeerAudio({ stream }: { stream: MediaStream | null }) {
  const ref = React.useRef<HTMLAudioElement>(null);
  React.useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (el.srcObject !== stream) el.srcObject = stream;
    if (stream) void el.play().catch(() => undefined);
  }, [stream]);
  return <audio ref={ref} autoPlay className="hidden" />;
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

/**
 * «Видеосвязь» — the meeting room of a live session, built into the LMS
 * (no Google Meet / Zoom needed). Teacher and students see and hear each
 * other, share screens, raise hands; the host can mute and lower hands.
 *
 * Docked at the top of the page; «Свернуть» turns it into a floating
 * mini-player so the call stays visible while scrolling the workbook.
 */
export function VideoRoom({
  sessionId,
  token,
  isHost,
  className,
}: {
  sessionId: string | undefined;
  token: string | null | undefined;
  /** Teacher page: joins with camera + mic on. */
  isHost?: boolean;
  className?: string;
}) {
  const t = useTranslations('videoRoom');
  const room = useVideoRoom(sessionId, token);
  const [floating, setFloating] = React.useState(false);
  const [preJoinOpen, setPreJoinOpen] = React.useState(false);

  // The join window closes by itself once we are in the call.
  React.useEffect(() => {
    if (room.status === 'joined') setPreJoinOpen(false);
  }, [room.status]);
  const [toast, setToast] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!room.moderatedAt) return;
    const key =
      room.moderatedAt.action === 'mute'
        ? 'mutedByHost'
        : room.moderatedAt.action === 'stop-video'
          ? 'videoStoppedByHost'
          : 'handLoweredByHost';
    setToast(t(key));
    const timer = window.setTimeout(() => setToast(null), 4000);
    return () => window.clearTimeout(timer);
  }, [room.moderatedAt, t]);

  const amHost = room.role === 'host';
  const joined = room.status === 'joined';

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

  // ── not joined ──────────────────────────────────────────────────────────
  if (!joined) {
    const busy = room.status === 'joining';
    return (
      <>
        <section
          id="video-room"
          className={cn(
            'flex scroll-mt-4 flex-wrap items-center gap-3 rounded-lg border border-primary/30 bg-primary/5 p-4',
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
              {busy ? t('connecting') : isHost ? t('hostHint') : t('studentHint')}
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
            disabled={!sessionId}
          >
            {busy ? <Spinner className="h-4 w-4" /> : <Video className="h-4 w-4" />}
            {isHost ? t('startCall') : t('join')}
          </Button>
        </section>
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
  const controls = (
    <div className="flex flex-wrap items-center justify-center gap-2">
      <Button
        type="button"
        size="icon"
        variant={room.media.audio ? 'secondary' : 'destructive'}
        onClick={() => void room.toggleAudio()}
        aria-pressed={room.media.audio}
        title={room.media.audio ? t('micOff') : t('micOn')}
        aria-label={room.media.audio ? t('micOff') : t('micOn')}
      >
        {room.media.audio ? <Mic className="h-4 w-4" /> : <MicOff className="h-4 w-4" />}
      </Button>
      <Button
        type="button"
        size="icon"
        variant={room.media.video ? 'secondary' : 'outline'}
        onClick={() => void room.toggleVideo()}
        aria-pressed={room.media.video}
        title={room.media.video ? t('camOff') : t('camOn')}
        aria-label={room.media.video ? t('camOff') : t('camOn')}
      >
        {room.media.video ? <Video className="h-4 w-4" /> : <VideoOff className="h-4 w-4" />}
      </Button>
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
      <Button
        type="button"
        size="icon"
        variant={room.media.hand ? 'default' : 'outline'}
        onClick={room.toggleHand}
        aria-pressed={room.media.hand}
        title={room.media.hand ? t('lowerMyHand') : t('raiseHand')}
        aria-label={room.media.hand ? t('lowerMyHand') : t('raiseHand')}
        className={cn(room.media.hand && 'bg-warning text-warning-foreground hover:bg-warning/90')}
      >
        <Hand className="h-4 w-4" />
      </Button>
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
      <Button
        type="button"
        size="icon"
        variant="outline"
        onClick={() => setFloating((f) => !f)}
        title={floating ? t('dock') : t('minimize')}
        aria-label={floating ? t('dock') : t('minimize')}
      >
        {floating ? <Maximize2 className="h-4 w-4" /> : <Minimize2 className="h-4 w-4" />}
      </Button>
      <Button
        type="button"
        size="icon"
        variant="destructive"
        onClick={room.leave}
        title={t('leave')}
        aria-label={t('leave')}
      >
        <PhoneOff className="h-4 w-4" />
      </Button>
    </div>
  );

  const stageView = stage ? (
    <div
      className={cn(
        'relative mx-auto aspect-video w-full overflow-hidden rounded-lg bg-black',
        !floating && 'max-w-3xl',
      )}
    >
      <StreamVideo stream={stage.stream} fit={stage.fit} mirror={stage.mirror} />
      <span className="absolute left-2 top-2 rounded bg-black/60 px-2 py-0.5 text-xs text-white">
        {stage.label}
      </span>
    </div>
  ) : (
    <div
      className={cn(
        'mx-auto flex w-full flex-col items-center justify-center gap-2 rounded-lg bg-muted text-center text-sm text-muted-foreground',
        floating ? 'aspect-video' : 'h-28 max-w-3xl',
      )}
    >
      <VideoOff className="h-6 w-6" aria-hidden />
      {t('nobodyOnCamera')}
    </div>
  );

  return (
    <>
      {/* Audio for every remote peer, independent of the visible layout. */}
      {room.peers.map((p) => (
        <PeerAudio key={p.peerId} stream={p.camera} />
      ))}

      {floating ? (
        <section
          className="fixed bottom-4 right-4 z-40 w-[min(360px,calc(100vw-2rem))] space-y-2 rounded-xl border bg-card p-2 shadow-2xl"
          aria-label={t('title')}
        >
          {stageView}
          <div className="flex items-center justify-between px-1 text-xs text-muted-foreground">
            <span className="inline-flex items-center gap-1">
              <Users className="h-3.5 w-3.5" /> {people}
            </span>
            {hands > 0 ? (
              <span className="inline-flex items-center gap-1 text-warning">
                <Hand className="h-3.5 w-3.5" /> {hands}
              </span>
            ) : null}
          </div>
          {controls}
        </section>
      ) : (
        <section
          id="video-room"
          className={cn('scroll-mt-4 space-y-3 rounded-lg border border-primary/30 bg-card p-3 shadow-sm', className)}
          aria-label={t('title')}
        >
          <header className="flex items-center gap-2">
            <span className="relative flex h-2.5 w-2.5">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-success opacity-75" />
              <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-success" />
            </span>
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
          </header>

          {stageView}

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
      )}

      {toast ? (
        <div
          role="status"
          className="fixed bottom-24 left-1/2 z-50 -translate-x-1/2 rounded-md bg-foreground px-4 py-2 text-sm text-background shadow-lg"
        >
          {toast}
        </div>
      ) : null}
    </>
  );
}
