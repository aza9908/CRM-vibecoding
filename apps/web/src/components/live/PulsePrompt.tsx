'use client';

import * as React from 'react';
import { useTranslations } from 'next-intl';
import { Check, X } from 'lucide-react';
import { PULSE_EMOJI, PULSE_VALUES, type PulseStatePayload, type PulseValue } from '@lms/shared';
import { usePulse, type PulseChannel } from '@/lib/ws/pulse-channel';
import { cn } from '@/lib/utils';

const RESULT_VISIBLE_MS = 5000;

const TONE: Record<PulseValue, { bar: string; on: string }> = {
  yes: { bar: 'bg-success', on: 'border-success bg-success/10 ring-2 ring-success/40' },
  partly: { bar: 'bg-warning', on: 'border-warning bg-warning/10 ring-2 ring-warning/40' },
  no: {
    bar: 'bg-destructive',
    on: 'border-destructive bg-destructive/10 ring-2 ring-destructive/40',
  },
};

/** Seconds left until `endsAt`, ticking 4×/s while the check is open. */
function useCountdown(state: PulseStatePayload | null): { left: number; fraction: number } {
  const [now, setNow] = React.useState(() => Date.now());
  const open = !!state && !state.closed;
  React.useEffect(() => {
    if (!open) return;
    setNow(Date.now());
    const id = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(id);
  }, [open, state?.id]);
  if (!state) return { left: 0, fraction: 0 };
  const start = new Date(state.startedAt).getTime();
  const end = new Date(state.endsAt).getTime();
  const total = Math.max(1, end - start);
  // Clocks differ between devices: clamp instead of trusting them blindly.
  const remaining = Math.max(0, Math.min(total, end - now));
  return { left: Math.ceil(remaining / 1000), fraction: remaining / total };
}

/**
 * «Пульс класса» for the audience. When the teacher asks "is everything
 * clear?", this card slides up at the bottom of the screen — three big emoji
 * buttons (also keys 1 · 2 · 3) and a shrinking timer. After answering it
 * shows the live picture of the group; when the check closes, a short result
 * card and then it gets out of the way.
 */
export function PulsePrompt({ channel }: { channel: PulseChannel }) {
  const t = useTranslations('pulse');
  const { state, mine } = usePulse(channel);
  const { left, fraction } = useCountdown(state);
  const [dismissedId, setDismissedId] = React.useState<string | null>(null);

  // A closed check is shown for a few seconds, then disappears by itself.
  const closedId = state?.closed ? state.id : null;
  React.useEffect(() => {
    if (!closedId) return;
    const timer = window.setTimeout(() => setDismissedId(closedId), RESULT_VISIBLE_MS);
    return () => window.clearTimeout(timer);
  }, [closedId]);

  const open = !!state && !state.closed;
  const answer = React.useCallback(
    (value: PulseValue) => {
      void channel.answer(value);
    },
    [channel],
  );

  // Keys 1 / 2 / 3 — unless the person is typing somewhere.
  React.useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const el = e.target as HTMLElement | null;
      if (el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName))) return;
      const value = PULSE_VALUES[Number(e.key) - 1];
      if (value) {
        e.preventDefault();
        answer(value);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, answer]);

  if (!state || dismissedId === state.id) return null;

  const question = state.question || t('defaultQuestion');
  const shell =
    'fixed inset-x-0 bottom-0 z-[60] mx-auto w-full max-w-xl px-3 pb-3 sm:bottom-4 sm:px-0 sm:pb-0';
  const card =
    'animate-pulse-in overflow-hidden rounded-2xl border bg-card text-card-foreground shadow-2xl';

  // ── closed: result ──────────────────────────────────────────────────────
  if (state.closed) {
    return (
      <div className={shell} data-pulse-result>
        <section className={card} role="status" aria-live="polite">
          <div className="flex items-start gap-3 p-4">
            <div
              className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-primary/10 text-lg font-bold tabular-nums text-primary"
              aria-hidden
            >
              {state.answered > 0 ? `${state.understanding}%` : '—'}
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {t('resultTitle')}
              </p>
              <p className="text-sm font-semibold">
                {state.answered > 0
                  ? t('resultLine', {
                      percent: state.understanding,
                      answered: state.answered,
                      eligible: state.eligible,
                    })
                  : t('resultNoAnswers')}
              </p>
              <Bars state={state} className="mt-2" />
            </div>
            <button
              type="button"
              onClick={() => setDismissedId(state.id)}
              aria-label={t('close')}
              className="rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </section>
      </div>
    );
  }

  // ── open: question ──────────────────────────────────────────────────────
  return (
    <div className={shell} data-pulse-prompt>
      <section className={card} role="dialog" aria-label={question}>
        {/* Shrinking timer. */}
        <div className="h-1.5 w-full bg-muted" aria-hidden>
          <div
            className="h-full origin-left bg-primary transition-transform duration-300 ease-linear"
            style={{ transform: `scaleX(${fraction})` }}
          />
        </div>
        <div className="space-y-3 p-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h2 className="break-words text-lg font-semibold leading-snug">{question}</h2>
              <p className="text-xs text-muted-foreground">
                {mine ? t('change') : t('promptHint')}
              </p>
            </div>
            <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-xs font-semibold tabular-nums text-muted-foreground">
              {t('secondsLeft', { seconds: left })}
            </span>
          </div>

          <div className="grid grid-cols-3 gap-2">
            {PULSE_VALUES.map((value, i) => {
              const selected = mine === value;
              return (
                <button
                  key={value}
                  type="button"
                  onClick={() => answer(value)}
                  aria-pressed={selected}
                  data-pulse-value={value}
                  className={cn(
                    'relative flex min-h-[5.5rem] flex-col items-center justify-center gap-1 rounded-xl border bg-background px-1 py-2 text-center transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring active:scale-95',
                    selected ? TONE[value].on : 'hover:border-primary/50 hover:bg-primary/5',
                  )}
                >
                  <span className="text-3xl leading-none sm:text-4xl" aria-hidden>
                    {PULSE_EMOJI[value]}
                  </span>
                  <span className="text-xs font-semibold leading-tight sm:text-sm">{t(value)}</span>
                  <kbd className="absolute left-1.5 top-1.5 hidden rounded border bg-muted px-1 text-[10px] font-medium text-muted-foreground sm:block">
                    {i + 1}
                  </kbd>
                  {selected ? (
                    <span className="absolute right-1.5 top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-foreground text-background">
                      <Check className="h-3 w-3" />
                    </span>
                  ) : null}
                </button>
              );
            })}
          </div>

          {mine ? (
            <div className="space-y-1.5" role="status" aria-live="polite">
              <p className="text-sm font-semibold text-success">{t('thanks')}</p>
              <Bars state={state} />
              <p className="text-xs text-muted-foreground">
                {t('answeredOf', { answered: state.answered, eligible: state.eligible })}
              </p>
            </div>
          ) : null}
        </div>
      </section>
    </div>
  );
}

/** Three thin bars: how the group answered so far. */
function Bars({ state, className }: { state: PulseStatePayload; className?: string }) {
  const total = Math.max(1, state.answered);
  return (
    <div className={cn('flex items-center gap-2', className)} aria-hidden>
      {PULSE_VALUES.map((value) => (
        <div key={value} className="flex min-w-0 flex-1 items-center gap-1.5">
          <span className="text-sm leading-none">{PULSE_EMOJI[value]}</span>
          <div className="h-2 min-w-0 flex-1 overflow-hidden rounded-full bg-muted">
            <div
              className={cn('h-full rounded-full transition-[width] duration-300', TONE[value].bar)}
              style={{ width: `${(100 * state.counts[value]) / total}%` }}
            />
          </div>
          <span className="w-4 text-right text-xs font-semibold tabular-nums">
            {state.counts[value]}
          </span>
        </div>
      ))}
    </div>
  );
}
