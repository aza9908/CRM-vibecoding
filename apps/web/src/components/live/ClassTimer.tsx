'use client';

import * as React from 'react';
import { useTranslations } from 'next-intl';
import { BellRing, Plus, Square, Timer, X } from 'lucide-react';
import type { TimerStatePayload } from '@lms/shared';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

/**
 * The class countdown («таймер»): the teacher starts it, everyone sees the
 * same time left and hears a bell when it runs out.
 *
 * Clocks differ between devices, so the time left is computed against the
 * server's clock (`serverNow` in the payload), not the local one.
 */

function fmt(totalSec: number): string {
  const s = Math.max(0, Math.ceil(totalSec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const pad = (n: number) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(s % 60)}` : `${pad(m)}:${pad(s % 60)}`;
}

/** Bell made with Web Audio — no sound file to load, works offline. */
function ringBell(times = 3): void {
  try {
    const Ctx =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new Ctx();
    void ctx.resume().catch(() => undefined);
    const strike = (at: number) => {
      // A struck bell: a fundamental with inharmonic partials, fast attack, long decay.
      for (const [ratio, gain] of [
        [1, 0.5],
        [2.76, 0.22],
        [5.4, 0.12],
      ] as const) {
        const osc = ctx.createOscillator();
        const g = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.value = 880 * ratio;
        g.gain.setValueAtTime(0.0001, at);
        g.gain.exponentialRampToValueAtTime(gain, at + 0.01);
        g.gain.exponentialRampToValueAtTime(0.0001, at + 1.3);
        osc.connect(g).connect(ctx.destination);
        osc.start(at);
        osc.stop(at + 1.35);
      }
    };
    for (let i = 0; i < times; i++) strike(ctx.currentTime + 0.05 + i * 0.75);
    window.setTimeout(() => void ctx.close().catch(() => undefined), times * 750 + 1800);
  } catch {
    /* no audio — the visual alert still shows */
  }
}

interface Clock {
  /** Seconds left (can go below 0 after the end). */
  left: number;
  durationSec: number;
}

/** Ticks 4×/s while a timer is set; null when there is none. */
function useClock(timer: TimerStatePayload | null | undefined): Clock | null {
  const endsAt = timer?.endsAt ?? null;
  const serverNow = timer?.serverNow ?? null;
  // Server clock minus local clock, fixed at the moment the state arrived.
  const offset = React.useMemo(
    () => (serverNow ? new Date(serverNow).getTime() - Date.now() : 0),
    [serverNow],
  );
  const [, tick] = React.useState(0);
  React.useEffect(() => {
    if (!endsAt) return;
    const id = window.setInterval(() => tick((n) => n + 1), 250);
    return () => window.clearInterval(id);
  }, [endsAt]);
  if (!endsAt || !timer) return null;
  return {
    left: (new Date(endsAt).getTime() - (Date.now() + offset)) / 1000,
    durationSec: timer.durationSec,
  };
}

/** How long «Время вышло!» stays on screen. */
const DONE_SHOW_SEC = 30;

/**
 * Floating countdown for everyone in the session. Rings once at zero and
 * shows «Время вышло!» for a while.
 */
export function ClassTimerBanner({
  timer,
  position = 'top',
}: {
  timer: TimerStatePayload | null | undefined;
  /** `bottom` on the teacher page, whose header holds the session code. */
  position?: 'top' | 'bottom';
}) {
  const t = useTranslations('timer');
  const clock = useClock(timer);
  const endsAt = timer?.endsAt ?? null;
  const rang = React.useRef<string | null>(null);
  const [dismissed, setDismissed] = React.useState<string | null>(null);

  const left = clock?.left ?? null;
  const done = left != null && left <= 0;
  React.useEffect(() => {
    if (!endsAt || left == null) return;
    // Ring once per timer, and only if we saw it end (not on a late page load).
    if (left <= 0 && left > -5 && rang.current !== endsAt) {
      rang.current = endsAt;
      ringBell(3);
    }
  }, [endsAt, left]);

  if (!clock || !endsAt || left == null) return null;
  if (left < -DONE_SHOW_SEC || dismissed === endsAt) return null;

  const fraction = clock.durationSec > 0 ? Math.min(1, Math.max(0, left / clock.durationSec)) : 0;
  const urgent = !done && left <= 60;
  const R = 20;
  const C = 2 * Math.PI * R;
  return (
    <div
      role="timer"
      aria-live={done ? 'assertive' : 'off'}
      data-class-timer={done ? 'done' : 'running'}
      className={cn(
        'fixed left-1/2 z-[65] flex -translate-x-1/2 items-center gap-3 rounded-full border py-1.5 pl-2 pr-4 shadow-xl transition-colors',
        position === 'bottom' ? 'bottom-5' : 'top-3',
        done
          ? 'animate-pulse border-red-600 bg-red-600 text-white'
          : urgent
            ? 'border-amber-400 bg-amber-50 text-amber-900'
            : 'border-primary/30 bg-card text-foreground',
      )}
    >
      {done ? (
        <span className="flex h-11 w-11 items-center justify-center rounded-full bg-white/20">
          <BellRing className="h-5 w-5" aria-hidden />
        </span>
      ) : (
        <svg width="44" height="44" viewBox="0 0 48 48" aria-hidden className="-rotate-90">
          <circle cx="24" cy="24" r={R} fill="none" stroke="currentColor" strokeOpacity="0.15" strokeWidth="5" />
          <circle
            cx="24"
            cy="24"
            r={R}
            fill="none"
            stroke="currentColor"
            strokeWidth="5"
            strokeLinecap="round"
            strokeDasharray={C}
            strokeDashoffset={C * (1 - fraction)}
            className={urgent ? 'text-amber-500' : 'text-primary'}
          />
        </svg>
      )}
      <span className="leading-tight">
        <span className="block text-[10px] font-semibold uppercase tracking-wide opacity-70">
          {done ? t('done') : t('left')}
        </span>
        <span className="block font-mono text-2xl font-bold tabular-nums">
          {done ? '00:00' : fmt(left)}
        </span>
      </span>
      {done ? (
        <button
          type="button"
          onClick={() => setDismissed(endsAt)}
          aria-label={t('hide')}
          className="ml-1 rounded-full p-1.5 hover:bg-white/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
        >
          <X className="h-4 w-4" />
        </button>
      ) : null}
    </div>
  );
}

const PRESETS = [5, 7, 10, 15, 30];

/** Teacher's control: pick a length, start, add time, stop. */
export function ClassTimerCard({
  timer,
  onSet,
  pending,
}: {
  timer: TimerStatePayload | null | undefined;
  /** `seconds` 0 = stop; `add` extends the running timer. */
  onSet: (seconds: number, add?: boolean) => void;
  pending?: boolean;
}) {
  const t = useTranslations('timer');
  const clock = useClock(timer);
  const running = !!clock && clock.left > 0;
  const [minutes, setMinutes] = React.useState(30);
  const valid = Number.isFinite(minutes) && minutes >= 1 && minutes <= 240;
  return (
    <div>
      <div className="flex items-center gap-2">
        <span className="flex h-9 w-9 items-center justify-center rounded-full bg-primary/10 text-primary">
          <Timer className="h-4 w-4" aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-semibold">{t('title')}</h2>
          <p className="text-xs text-muted-foreground">{t('hint')}</p>
        </div>
        {running ? (
          <span className="font-mono text-2xl font-bold tabular-nums text-primary">
            {fmt(clock!.left)}
          </span>
        ) : null}
      </div>
      {running ? (
        <div className="mt-3 grid grid-cols-2 gap-2">
          <Button type="button" variant="outline" disabled={pending} onClick={() => onSet(300, true)}>
            <Plus className="h-4 w-4" /> {t('add5')}
          </Button>
          <Button type="button" variant="destructive" disabled={pending} onClick={() => onSet(0)}>
            <Square className="h-4 w-4" /> {t('stop')}
          </Button>
        </div>
      ) : (
        <>
          <div className="mt-3 grid grid-cols-5 gap-1.5" role="radiogroup" aria-label={t('title')}>
            {PRESETS.map((m) => (
              <button
                key={m}
                type="button"
                role="radio"
                aria-checked={minutes === m}
                onClick={() => setMinutes(m)}
                className={cn(
                  'rounded-lg border py-2 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                  minutes === m
                    ? 'border-primary bg-primary/10 text-primary'
                    : 'bg-background hover:bg-accent',
                )}
              >
                {t('min', { n: m })}
              </button>
            ))}
          </div>
          <div className="mt-2 flex gap-2">
            <label className="flex flex-1 items-center gap-2 rounded-lg border bg-background px-3 text-sm">
              <span className="text-muted-foreground">{t('custom')}</span>
              <input
                type="number"
                min={1}
                max={240}
                value={Number.isFinite(minutes) ? minutes : ''}
                onChange={(e) => setMinutes(e.target.valueAsNumber)}
                aria-label={t('custom')}
                className="h-10 w-full min-w-0 bg-transparent text-right font-mono outline-none"
              />
            </label>
            <Button
              type="button"
              disabled={pending || !valid}
              onClick={() => onSet(Math.round(minutes * 60))}
            >
              <Timer className="h-4 w-4" /> {t('start')}
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
