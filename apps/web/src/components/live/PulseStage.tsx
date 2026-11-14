'use client';

import * as React from 'react';
import { useTranslations } from 'next-intl';
import { Activity, ChevronDown, Square } from 'lucide-react';
import { PULSE_EMOJI, type PulseStatePayload } from '@lms/shared';
import { usePulse, type PulseChannel } from '@/lib/ws/pulse-channel';
import { cn } from '@/lib/utils';

function useSecondsLeft(state: PulseStatePayload | null): number {
  const [now, setNow] = React.useState(() => Date.now());
  const open = !!state && !state.closed;
  React.useEffect(() => {
    if (!open) return;
    const id = window.setInterval(() => setNow(Date.now()), 500);
    return () => window.clearInterval(id);
  }, [open, state?.id]);
  if (!state || state.closed) return 0;
  return Math.max(0, Math.ceil((new Date(state.endsAt).getTime() - now) / 1000));
}

/**
 * «Пульс класса» for the teacher while slides are on the full screen: ask
 * "всё понятно?" without leaving fullscreen and watch the answers come in —
 * how many pressed 👍, how many are unsure, how many stay silent.
 * Solid background (no blur) so it costs nothing to draw over a slide.
 */
export function PulseStage({ channel }: { channel: PulseChannel }) {
  const t = useTranslations('pulse');
  const { state, detail } = usePulse(channel);
  const [busy, setBusy] = React.useState(false);
  const left = useSecondsLeft(state);
  const running = !!state && !state.closed;

  const ask = async () => {
    setBusy(true);
    await channel.start('');
    setBusy(false);
  };

  const silent = running && detail && detail.id === state?.id ? detail.pending.length : null;
  const [collapsed, setCollapsed] = React.useState(false);

  if (collapsed) {
    return (
      <button
        type="button"
        data-pulse-stage
        onClick={() => setCollapsed(false)}
        className="fixed bottom-4 left-4 z-[10001] inline-flex items-center gap-2 rounded-full border border-white/15 bg-neutral-900/95 px-3.5 py-2 text-sm font-semibold text-white shadow-2xl"
        title={t('title')}
      >
        {running ? <span className="h-2 w-2 animate-pulse rounded-full bg-emerald-400" /> : <Activity className="h-4 w-4" />}
        <span aria-hidden>{PULSE_EMOJI.yes}</span>
        <span className="tabular-nums" data-pulse-stage-yes>
          {state ? `${state.counts.yes} / ${state.eligible}` : t('defaultQuestion')}
        </span>
      </button>
    );
  }

  return (
    <div
      data-pulse-stage
      className="fixed bottom-4 left-4 z-[10001] w-[min(22rem,calc(100vw-2rem))] rounded-xl border border-white/15 bg-neutral-900/95 p-3 text-white shadow-2xl"
    >
      <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-white/70">
        <Activity className="h-3.5 w-3.5" />
        {t('title')}
        {running ? (
          <span className="ml-auto inline-flex items-center gap-1.5 normal-case tracking-normal text-white/80">
            <span className="h-2 w-2 animate-pulse rounded-full bg-emerald-400" />
            {t('secondsLeft', { seconds: left })}
          </span>
        ) : null}
        <button
          type="button"
          onClick={() => setCollapsed(true)}
          className={cn('rounded-md p-1 text-white/70 hover:bg-white/10 hover:text-white', !running && 'ml-auto')}
          aria-label={t('close')}
          title={t('close')}
        >
          <ChevronDown className="h-4 w-4" />
        </button>
      </div>

      {state ? (
        <>
          <p className="mb-2 truncate text-sm font-semibold">{state.question || t('defaultQuestion')}</p>
          <div className="flex items-end gap-3">
            <div className="flex items-baseline gap-2" data-pulse-stage-yes>
              <span className="text-3xl leading-none" aria-hidden>
                {PULSE_EMOJI.yes}
              </span>
              <span className="text-4xl font-extrabold tabular-nums leading-none">{state.counts.yes}</span>
            </div>
            <p className="pb-0.5 text-xs leading-snug text-white/80">
              {t('stageYesOf', { yes: state.counts.yes, eligible: state.eligible })}
              <br />
              {state.answered > 0 ? t('understandingLong', { percent: state.understanding }) : t('nobodyYet')}
            </p>
          </div>
          <div className="mt-3 grid grid-cols-3 gap-1.5 text-center text-xs">
            <Stat emoji={PULSE_EMOJI.partly} value={state.counts.partly} label={t('partly')} />
            <Stat emoji={PULSE_EMOJI.no} value={state.counts.no} label={t('no')} />
            <Stat
              value={silent ?? Math.max(0, state.eligible - state.answered)}
              label={t('stageSilent')}
              muted
            />
          </div>
          {/* answered of eligible */}
          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/15">
            <div
              className="h-full rounded-full bg-emerald-400 transition-[width] duration-500"
              style={{ width: `${state.participation}%` }}
            />
          </div>
          <p className="mt-1 text-[11px] text-white/60">
            {t('answeredOf', { answered: state.answered, eligible: state.eligible })}
          </p>
        </>
      ) : (
        <p className="mb-2 text-xs text-white/70">{t('hint')}</p>
      )}

      <div className="mt-3">
        {running ? (
          <button
            type="button"
            onClick={() => void channel.close()}
            className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-white/10 px-3 py-2 text-sm font-semibold hover:bg-white/20"
          >
            <Square className="h-3.5 w-3.5" />
            {t('finish')}
          </button>
        ) : (
          <button
            type="button"
            disabled={busy}
            onClick={() => void ask()}
            className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-60"
          >
            <span aria-hidden>{PULSE_EMOJI.yes}</span>
            {busy ? t('starting') : state ? t('askAgain') : t('ask')}
          </button>
        )}
      </div>
    </div>
  );
}

function Stat({
  emoji,
  value,
  label,
  muted,
}: {
  emoji?: string;
  value: number;
  label: string;
  muted?: boolean;
}) {
  return (
    <div className={cn('rounded-lg bg-white/10 px-1.5 py-1.5', muted && 'bg-white/5')}>
      <div className="text-base font-bold tabular-nums leading-tight">
        {emoji ? <span aria-hidden className="mr-1">{emoji}</span> : null}
        {value}
      </div>
      <div className="truncate text-[10px] text-white/70">{label}</div>
    </div>
  );
}
