'use client';

import * as React from 'react';
import { useTranslations } from 'next-intl';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Activity, Square } from 'lucide-react';
import {
  PULSE_EMOJI,
  PULSE_QUESTION_MAX,
  PULSE_VALUES,
  type PulseCheckRecord,
  type PulseStatePayload,
  type PulseValue,
} from '@lms/shared';
import { api } from '@/lib/api/client';
import { usePulse, type PulseChannel } from '@/lib/ws/pulse-channel';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { cn } from '@/lib/utils';

const TONE: Record<PulseValue, string> = {
  yes: 'text-success',
  partly: 'text-warning',
  no: 'text-destructive',
};

/** Colour of the gauge by how well the group follows. */
function gaugeColor(percent: number, answered: number): string {
  if (answered === 0) return 'hsl(var(--muted-foreground))';
  if (percent >= 75) return 'hsl(var(--success))';
  if (percent >= 50) return 'hsl(var(--warning))';
  return 'hsl(var(--destructive))';
}

/** Ring gauge with the understanding % in the middle. */
function Gauge({ percent, answered, label }: { percent: number; answered: number; label: string }) {
  const R = 44;
  const C = 2 * Math.PI * R;
  const shown = answered > 0 ? percent : 0;
  return (
    <div className="relative h-28 w-28 shrink-0" role="img" aria-label={`${shown}% ${label}`}>
      <svg viewBox="0 0 100 100" className="h-full w-full -rotate-90">
        <circle cx="50" cy="50" r={R} fill="none" stroke="hsl(var(--muted))" strokeWidth="9" />
        <circle
          cx="50"
          cy="50"
          r={R}
          fill="none"
          stroke={gaugeColor(percent, answered)}
          strokeWidth="9"
          strokeLinecap="round"
          strokeDasharray={C}
          strokeDashoffset={C * (1 - shown / 100)}
          style={{ transition: 'stroke-dashoffset 500ms ease, stroke 300ms ease' }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-2xl font-bold tabular-nums leading-none" data-pulse-understanding>
          {answered > 0 ? `${percent}%` : '—'}
        </span>
        <span className="mt-0.5 text-[11px] text-muted-foreground">{label}</span>
      </div>
    </div>
  );
}

function SecondsLeft({ state }: { state: PulseStatePayload }) {
  const t = useTranslations('pulse');
  const [now, setNow] = React.useState(() => Date.now());
  React.useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 500);
    return () => window.clearInterval(id);
  }, []);
  const total = new Date(state.endsAt).getTime() - new Date(state.startedAt).getTime();
  const left = Math.max(0, Math.min(total, new Date(state.endsAt).getTime() - now));
  return <span className="tabular-nums">{t('secondsLeft', { seconds: Math.ceil(left / 1000) })}</span>;
}

/**
 * «Пульс класса» — the teacher's side. One button asks the whole room "is
 * everything clear?"; while people answer, the card shows the understanding
 * gauge, who has not answered yet and who said what. Afterwards: the result,
 * the session's history and an involvement table that makes silent
 * participants visible.
 */
export function PulseTeacherCard({
  channel,
  sessionId,
  className,
}: {
  channel: PulseChannel;
  sessionId: string | undefined;
  className?: string;
}) {
  const t = useTranslations('pulse');
  const { state, detail } = usePulse(channel);
  const [question, setQuestion] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const queryClient = useQueryClient();

  const historyKey = React.useMemo(() => ['session-pulses', sessionId] as const, [sessionId]);
  const history = useQuery({
    queryKey: historyKey,
    queryFn: () => api.get<PulseCheckRecord[]>(`/sessions/${sessionId}/pulses`),
    enabled: !!sessionId,
    staleTime: 30_000,
  });

  // A check just closed → it is being written; refresh the history shortly.
  const closedId = state?.closed ? state.id : null;
  React.useEffect(() => {
    if (!closedId) return;
    const timer = window.setTimeout(
      () => void queryClient.invalidateQueries({ queryKey: historyKey }),
      800,
    );
    return () => window.clearTimeout(timer);
  }, [closedId, queryClient, historyKey]);

  const running = !!state && !state.closed;

  const start = async () => {
    setError(null);
    setBusy(true);
    const res = await channel.start(question.trim().slice(0, PULSE_QUESTION_MAX));
    setBusy(false);
    if (res.ok) {
      setQuestion('');
      return;
    }
    setError(
      res.error === 'already_running'
        ? t('errorAlready')
        : res.error === 'offline' || res.error === 'timeout'
          ? t('errorOffline')
          : t('errorGeneric'),
    );
  };

  // History incl. the check that closed a moment ago (not stored yet).
  const checks = React.useMemo<PulseCheckRecord[]>(() => {
    const stored = history.data ?? [];
    if (!state?.closed || !detail || detail.id !== state.id) return stored;
    if (stored.some((c) => c.id === state.id)) return stored;
    return [
      ...stored,
      {
        id: state.id,
        question: state.question,
        startedAt: state.startedAt,
        closedAt: state.endsAt,
        eligible: state.eligible,
        answered: state.answered,
        understanding: state.understanding,
        answers: detail.answers,
        pending: detail.pending,
      },
    ];
  }, [history.data, state, detail]);

  // Involvement: how many checks each person answered.
  const involvement = React.useMemo(() => {
    const people = new Map<string, { name: string; answered: number; asked: number }>();
    for (const c of checks) {
      for (const a of c.answers) {
        const p = people.get(a.id) ?? { name: a.name, answered: 0, asked: 0 };
        p.answered += 1;
        p.asked += 1;
        people.set(a.id, p);
      }
      for (const a of c.pending) {
        const p = people.get(a.id) ?? { name: a.name, answered: 0, asked: 0 };
        p.asked += 1;
        people.set(a.id, p);
      }
    }
    return [...people.entries()]
      .map(([id, p]) => ({ id, ...p }))
      .sort((a, b) => a.answered / a.asked - b.answered / b.asked || a.name.localeCompare(b.name));
  }, [checks]);

  const shown = state; // running or last result of this page load
  const lastStored = !shown && checks.length > 0 ? checks[checks.length - 1]! : null;

  return (
    <section className={cn('space-y-4', className)} aria-label={t('title')} data-pulse-teacher>
      <header className="flex items-start gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
          <Activity className="h-4 w-4" aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="flex items-center gap-2 text-sm font-semibold">
            {t('title')}
            {running ? (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-success/15 px-2 py-0.5 text-[11px] font-semibold text-success">
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-success" />
                {t('running')}
              </span>
            ) : null}
          </h2>
          <p className="text-xs text-muted-foreground">{t('hint')}</p>
        </div>
      </header>

      {/* Ask */}
      {!running ? (
        <div className="space-y-2">
          <label className="block text-xs font-medium text-muted-foreground" htmlFor="pulse-question">
            {t('customLabel')}
          </label>
          <input
            id="pulse-question"
            value={question}
            onChange={(e) => setQuestion(e.target.value.slice(0, PULSE_QUESTION_MAX))}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !busy) void start();
            }}
            maxLength={PULSE_QUESTION_MAX}
            placeholder={t('customPlaceholder')}
            className="h-9 w-full rounded-md border bg-background px-3 text-sm outline-none ring-offset-background focus-visible:ring-2 focus-visible:ring-ring"
          />
          <Button
            type="button"
            size="lg"
            className="w-full"
            onClick={() => void start()}
            disabled={busy || !sessionId}
            data-pulse-ask
          >
            {busy ? <Spinner className="h-4 w-4" /> : <span aria-hidden>👍</span>}
            {busy ? t('starting') : shown || lastStored ? t('askAgain') : t('ask')}
          </Button>
          {error ? (
            <p className="text-xs text-destructive" role="alert">
              {error}
            </p>
          ) : null}
        </div>
      ) : null}

      {/* Running check / its result */}
      {shown ? (
        <div className="space-y-3 rounded-xl border bg-muted/30 p-3" data-pulse-current>
          <p className="break-words text-sm font-semibold">
            {shown.question || t('defaultQuestion')}
          </p>
          <div className="flex items-center gap-4">
            <Gauge
              percent={shown.understanding}
              answered={shown.answered}
              label={t('understanding')}
            />
            <div className="min-w-0 flex-1 space-y-1.5">
              <p className="text-sm font-semibold" data-pulse-answered>
                {t('answeredOf', { answered: shown.answered, eligible: shown.eligible })}
              </p>
              <p className="text-xs text-muted-foreground">
                {t('participation', { percent: shown.participation })}
                {running ? (
                  <>
                    {' · '}
                    <SecondsLeft state={shown} />
                  </>
                ) : null}
              </p>
              <div className="flex gap-2">
                {PULSE_VALUES.map((value) => (
                  <span
                    key={value}
                    title={t(value)}
                    data-pulse-count={value}
                    className="inline-flex items-center gap-1 rounded-full border bg-background px-2 py-0.5 text-sm font-semibold tabular-nums"
                  >
                    <span aria-hidden>{PULSE_EMOJI[value]}</span>
                    <span className="sr-only">{t(value)}</span>
                    {shown.counts[value]}
                  </span>
                ))}
              </div>
            </div>
          </div>

          {shown.eligible === 0 ? (
            <p className="text-xs text-muted-foreground">{t('noAudience')}</p>
          ) : null}

          {detail && detail.id === shown.id ? (
            <div className="grid gap-3 sm:grid-cols-2">
              <div data-pulse-pending>
                <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  {t('pendingTitle')} · {detail.pending.length}
                </h3>
                {detail.pending.length === 0 ? (
                  <p className="text-xs text-success">{t('pendingNone')}</p>
                ) : (
                  <ul className="flex flex-wrap gap-1">
                    {detail.pending.map((p) => (
                      <li
                        key={p.id}
                        className="max-w-full truncate rounded-full border border-dashed bg-background px-2 py-0.5 text-xs"
                      >
                        {p.name}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              <div data-pulse-answers>
                <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  {t('answersTitle')}
                </h3>
                {detail.answers.length === 0 ? (
                  <p className="text-xs text-muted-foreground">{t('nobodyYet')}</p>
                ) : (
                  <ul className="flex flex-wrap gap-1">
                    {detail.answers.map((a) => (
                      <li
                        key={a.id}
                        title={t(a.value)}
                        className="inline-flex max-w-full items-center gap-1 rounded-full border bg-background px-2 py-0.5 text-xs"
                      >
                        <span aria-hidden>{PULSE_EMOJI[a.value]}</span>
                        <span className="truncate">{a.name}</span>
                        <span className={cn('sr-only', TONE[a.value])}>{t(a.value)}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          ) : null}

          {running ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="w-full"
              onClick={() => void channel.close()}
              data-pulse-finish
            >
              <Square className="h-3.5 w-3.5" />
              {t('finish')}
            </Button>
          ) : null}
        </div>
      ) : lastStored ? (
        <div className="flex items-center gap-3 rounded-xl border bg-muted/30 p-3">
          <span className="text-2xl font-bold tabular-nums">{lastStored.understanding}%</span>
          <div className="min-w-0 text-xs text-muted-foreground">
            <p className="font-semibold text-foreground">{t('lastResult')}</p>
            <p>{t('answeredOf', { answered: lastStored.answered, eligible: lastStored.eligible })}</p>
          </div>
        </div>
      ) : null}

      {/* History + involvement */}
      {checks.length > 0 ? (
        <details className="group rounded-xl border" data-pulse-history>
          <summary className="flex cursor-pointer list-none items-center justify-between gap-2 px-3 py-2 text-sm font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
            <span>
              {t('historyTitle')} · {checks.length}
            </span>
            <span className="text-xs font-normal text-muted-foreground group-open:hidden">
              {Math.round(checks.reduce((n, c) => n + c.understanding, 0) / checks.length)}%
            </span>
          </summary>
          <div className="space-y-3 border-t p-3">
            <ol className="space-y-1.5">
              {checks.map((c, i) => (
                <li key={c.id} className="flex items-center gap-2 text-xs">
                  <span className="w-5 shrink-0 text-muted-foreground tabular-nums">{i + 1}.</span>
                  <span className="min-w-0 flex-1 truncate">{c.question || t('defaultQuestion')}</span>
                  <span className="shrink-0 text-muted-foreground tabular-nums">
                    {c.answered}/{c.eligible}
                  </span>
                  <span
                    className="w-10 shrink-0 text-right font-semibold tabular-nums"
                    style={{ color: gaugeColor(c.understanding, c.answered) }}
                  >
                    {c.answered > 0 ? `${c.understanding}%` : '—'}
                  </span>
                </li>
              ))}
            </ol>
            {involvement.length > 0 ? (
              <div data-pulse-involvement>
                <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  {t('involvementTitle')}
                </h3>
                <p className="mb-1.5 text-[11px] text-muted-foreground">
                  {t('involvementHint', { total: checks.length })}
                </p>
                <ul className="space-y-1">
                  {involvement.map((p) => {
                    const passive = p.answered === 0;
                    return (
                      <li key={p.id} className="flex items-center gap-2 text-xs">
                        <span className={cn('min-w-0 flex-1 truncate', passive && 'font-semibold')}>
                          {p.name}
                        </span>
                        {passive ? (
                          <span className="shrink-0 rounded-full bg-destructive/10 px-1.5 py-0.5 text-[10px] font-semibold text-destructive">
                            {t('passive')}
                          </span>
                        ) : null}
                        <span className="h-1.5 w-16 shrink-0 overflow-hidden rounded-full bg-muted">
                          <span
                            className={cn('block h-full rounded-full', passive ? 'bg-destructive' : 'bg-success')}
                            style={{ width: `${Math.max(6, (100 * p.answered) / p.asked)}%` }}
                          />
                        </span>
                        <span className="w-12 shrink-0 text-right tabular-nums text-muted-foreground">
                          {t('answeredChecks', { count: p.answered, total: p.asked })}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ) : null}
          </div>
        </details>
      ) : history.isSuccess && !shown ? (
        <p className="text-xs text-muted-foreground">{t('noHistory')}</p>
      ) : null}
    </section>
  );
}
