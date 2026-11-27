'use client';

import * as React from 'react';
import { useTranslations } from 'next-intl';
import { Check, LifeBuoy, Send, X } from 'lucide-react';
import type { RtcDiagIssue, RtcDiagKind } from '@lms/shared';
import { useDiag, type DiagChannel } from '@/lib/ws/diag-channel';
import { cn } from '@/lib/utils';

/**
 * «Помощник тренера» — for teachers only: who in the call has a technical
 * problem right now (mic blocked, camera busy, no sound, bad internet…), in
 * plain words, with a one-line fix the teacher can read out — or send to
 * that one person with «Отправить подсказку».
 *
 * Fed by `DiagChannel` (teachers' room of the session socket); the student
 * page never renders this.
 */

/** Open issues of other people (my own are not news to me). */
export function useCoachIssues(diag: DiagChannel, selfId: string | null): RtcDiagIssue[] {
  const { issues } = useDiag(diag);
  return React.useMemo(
    () => (selfId ? issues.filter((i) => i.peerId !== selfId) : issues),
    [issues, selfId],
  );
}

function minutesSince(iso: string, now: number): number {
  const t = Date.parse(iso);
  return Number.isFinite(t) ? Math.max(0, Math.floor((now - t) / 60_000)) : 0;
}

export function CoachButton({
  count,
  open,
  onClick,
  compact,
}: {
  count: number;
  open: boolean;
  onClick: () => void;
  compact?: boolean;
}) {
  const t = useTranslations('videoRoom.coach');
  const label = count > 0 ? `${t('button')} (${count})` : t('button');
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
      aria-haspopup="dialog"
      aria-expanded={open}
      data-coach-menu
      className={cn(
        'relative inline-flex shrink-0 items-center justify-center gap-2 rounded-full font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/80',
        compact ? 'h-9 w-9' : 'h-11 px-3 text-sm sm:h-12 sm:px-4',
        open
          ? 'bg-white text-neutral-900 hover:bg-white/90'
          : count > 0
            ? 'bg-amber-500/90 text-black hover:bg-amber-400'
            : 'bg-white/10 text-white hover:bg-white/20',
      )}
    >
      <LifeBuoy className={compact ? 'h-4 w-4' : 'h-5 w-5'} aria-hidden />
      {compact ? null : <span className="hidden lg:inline">{t('button')}</span>}
      {count > 0 ? (
        <span
          className="absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-red-600 px-1 text-[11px] font-bold leading-none text-white ring-2 ring-neutral-950"
          data-testid="coach-count"
        >
          {count}
        </span>
      ) : null}
    </button>
  );
}

type SendState = 'sending' | 'sent' | 'failed';

export function CoachPanel({
  diag,
  issues,
  onClose,
  className,
}: {
  diag: DiagChannel;
  issues: RtcDiagIssue[];
  onClose: () => void;
  className?: string;
}) {
  const t = useTranslations('videoRoom.coach');
  const [now, setNow] = React.useState(() => Date.now());
  React.useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 20_000);
    return () => window.clearInterval(id);
  }, []);
  const [sent, setSent] = React.useState<Record<string, SendState>>({});

  // One card per person, the longest-waiting first.
  const groups = React.useMemo(() => {
    const byPeer = new Map<string, { peerId: string; name: string; items: RtcDiagIssue[] }>();
    for (const issue of issues) {
      let g = byPeer.get(issue.peerId);
      if (!g) byPeer.set(issue.peerId, (g = { peerId: issue.peerId, name: issue.name, items: [] }));
      g.items.push(issue);
    }
    return [...byPeer.values()];
  }, [issues]);

  const sendHint = async (peerId: string, kind: RtcDiagKind) => {
    const key = `${peerId}:${kind}`;
    setSent((s) => ({ ...s, [key]: 'sending' }));
    const res = await diag.hint(peerId, kind);
    setSent((s) => ({ ...s, [key]: res.ok ? 'sent' : 'failed' }));
    // Can be sent again a little later (the person may need a reminder).
    window.setTimeout(
      () =>
        setSent((s) => {
          const next = { ...s };
          delete next[key];
          return next;
        }),
      res.ok ? 30_000 : 5_000,
    );
  };

  return (
    <div
      role="dialog"
      aria-label={t('title')}
      data-coach-menu
      data-testid="coach-panel"
      className={cn(
        'z-30 flex max-h-[min(70vh,34rem)] w-[min(24rem,calc(100vw-1.5rem))] flex-col overflow-hidden rounded-xl border bg-card text-left text-card-foreground shadow-2xl',
        className,
      )}
    >
      <div className="flex items-center gap-2 border-b px-3 py-2">
        <LifeBuoy className="h-4 w-4 text-primary" aria-hidden />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold">{t('title')}</p>
          <p className="text-[11px] text-muted-foreground">{t('onlyYou')}</p>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label={t('close')}
          className="rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        {groups.length === 0 ? (
          <div className="px-2 py-6 text-center">
            <p className="text-sm font-medium">{t('empty')}</p>
            <p className="mt-1 text-xs text-muted-foreground">{t('emptyHint')}</p>
          </div>
        ) : (
          <ul className="space-y-2">
            {groups.map((g) => (
              <li key={g.peerId} className="rounded-lg border bg-background/60 p-2" data-testid="coach-person">
                <p className="truncate text-sm font-semibold">{g.name}</p>
                <ul className="mt-1 space-y-2">
                  {g.items.map((issue) => {
                    const key = `${issue.peerId}:${issue.kind}`;
                    const state = sent[key];
                    const min = minutesSince(issue.since, now);
                    return (
                      <li key={issue.kind} data-kind={issue.kind}>
                        <p className="flex items-baseline gap-2 text-[13px]">
                          <span className="font-medium text-amber-700 dark:text-amber-400">
                            {t(`kinds.${issue.kind}`)}
                          </span>
                          <span className="ml-auto shrink-0 text-[11px] text-muted-foreground">
                            {min < 1 ? t('justNow') : t('ago', { min })}
                          </span>
                        </p>
                        {issue.detail ? (
                          <p className="text-[11px] text-muted-foreground">{issue.detail}</p>
                        ) : null}
                        <p className="mt-0.5 text-xs text-muted-foreground">{t(`fix.${issue.kind}`)}</p>
                        <button
                          type="button"
                          onClick={() => void sendHint(issue.peerId, issue.kind)}
                          disabled={state === 'sending' || state === 'sent'}
                          className={cn(
                            'mt-1 inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-semibold transition-colors disabled:opacity-80',
                            state === 'sent'
                              ? 'bg-success/15 text-success'
                              : state === 'failed'
                                ? 'bg-destructive/10 text-destructive hover:bg-destructive/15'
                                : 'bg-primary/10 text-primary hover:bg-primary/15',
                          )}
                        >
                          {state === 'sent' ? <Check className="h-3.5 w-3.5" /> : <Send className="h-3.5 w-3.5" />}
                          {state === 'sent' ? t('hintSent') : state === 'failed' ? t('hintFailed') : t('sendHint')}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
