'use client';

import * as React from 'react';
import { useTranslations } from 'next-intl';
import { Check, ChevronUp, MessageCircleQuestion, Mic, RotateCcw, Send } from 'lucide-react';
import type { QaQuestion, QaStatus } from '@lms/shared';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';

const ASK_MAX = 300;

function sortOpen(a: QaQuestion, b: QaQuestion): number {
  if (a.status !== b.status) return a.status === 'live' ? -1 : 1;
  return b.votes - a.votes || a.at.localeCompare(b.at);
}

/**
 * «Вопросы» — the live Q&A queue of a session.
 *
 * Students ask in one tap and upvote each other's questions, so the most
 * wanted ones rise to the top. The host gives the floor (the asker gets a
 * prompt to turn on the mic in the video room) or marks a question answered.
 */
export function QaPanel({
  questions,
  selfId,
  isHost,
  onAsk,
  onVote,
  onStatus,
  className,
}: {
  questions: QaQuestion[];
  selfId: string | null;
  isHost?: boolean;
  onAsk: (text: string) => void;
  onVote: (questionId: string) => void;
  onStatus?: (questionId: string, status: QaStatus) => void;
  className?: string;
}) {
  const t = useTranslations('qa');
  const [draft, setDraft] = React.useState('');
  const [view, setView] = React.useState<'open' | 'answered'>('open');
  const [justSent, setJustSent] = React.useState(false);

  const open = React.useMemo(
    () => questions.filter((q) => q.status !== 'answered').sort(sortOpen),
    [questions],
  );
  const answered = React.useMemo(
    () =>
      questions
        .filter((q) => q.status === 'answered')
        .sort((a, b) => b.at.localeCompare(a.at)),
    [questions],
  );
  const list = view === 'open' ? open : answered;

  React.useEffect(() => {
    if (!justSent) return;
    const timer = window.setTimeout(() => setJustSent(false), 2500);
    return () => window.clearTimeout(timer);
  }, [justSent]);

  const send = () => {
    const text = draft.trim();
    if (!text) return;
    onAsk(text);
    setDraft('');
    setJustSent(true);
    setView('open');
  };

  return (
    <div className={cn('flex flex-col gap-3', className)}>
      {!isHost ? (
        <div className="space-y-2">
          <Textarea
            value={draft}
            maxLength={ASK_MAX}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                send();
              }
            }}
            placeholder={t('placeholder')}
            aria-label={t('placeholder')}
            className="min-h-[64px] resize-none text-sm"
          />
          <div className="flex items-center gap-2">
            <Button type="button" size="sm" onClick={send} disabled={!draft.trim()}>
              <Send className="h-4 w-4" />
              {t('ask')}
            </Button>
            <span
              className={cn(
                'text-xs',
                justSent ? 'font-medium text-success' : 'text-muted-foreground',
              )}
              role={justSent ? 'status' : undefined}
            >
              {justSent ? t('sent') : t('hint')}
            </span>
          </div>
        </div>
      ) : null}

      <div className="inline-flex w-full rounded-md bg-muted p-1 text-xs font-medium" role="tablist">
        {(['open', 'answered'] as const).map((v) => (
          <button
            key={v}
            type="button"
            role="tab"
            aria-selected={view === v}
            onClick={() => setView(v)}
            className={cn(
              'flex-1 rounded px-2 py-1.5 transition-colors',
              view === v
                ? 'bg-card text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {v === 'open'
              ? t('tabOpen', { count: open.length })
              : t('tabAnswered', { count: answered.length })}
          </button>
        ))}
      </div>

      {list.length === 0 ? (
        <div className="flex flex-col items-center gap-2 py-6 text-center text-sm text-muted-foreground">
          <MessageCircleQuestion className="h-6 w-6" aria-hidden />
          {view === 'open' ? (isHost ? t('emptyHost') : t('empty')) : t('emptyAnswered')}
        </div>
      ) : (
        <ul className="space-y-2">
          {list.map((q) => {
            const voted = !!selfId && q.voterIds.includes(selfId);
            const mine = !!selfId && q.authorId === selfId;
            const live = q.status === 'live';
            const done = q.status === 'answered';
            return (
              <li
                key={q.id}
                className={cn(
                  'flex gap-3 rounded-lg border bg-card p-3',
                  live && 'border-success ring-1 ring-success/40',
                  done && 'opacity-80',
                )}
              >
                <button
                  type="button"
                  onClick={() => onVote(q.id)}
                  disabled={done}
                  aria-pressed={voted}
                  aria-label={voted ? t('unvote') : t('vote')}
                  title={voted ? t('unvote') : t('vote')}
                  className={cn(
                    'flex h-12 w-10 shrink-0 flex-col items-center justify-center rounded-md border text-xs font-semibold transition-colors',
                    voted
                      ? 'border-primary bg-primary text-primary-foreground'
                      : 'border-border text-muted-foreground hover:border-primary hover:text-primary',
                    done && 'pointer-events-none',
                  )}
                >
                  <ChevronUp className="h-4 w-4" aria-hidden />
                  {q.votes}
                </button>
                <div className="min-w-0 flex-1 space-y-1.5">
                  {live ? (
                    <span className="inline-flex items-center gap-1.5 rounded-full bg-success/15 px-2 py-0.5 text-[11px] font-semibold text-success">
                      <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-success" />
                      {t('live')}
                    </span>
                  ) : null}
                  {done ? (
                    <span className="inline-flex items-center gap-1 rounded-full bg-success/15 px-2 py-0.5 text-[11px] font-semibold text-success">
                      <Check className="h-3 w-3" /> {t('answered')}
                    </span>
                  ) : null}
                  <p className="whitespace-pre-wrap break-words text-sm">{q.text}</p>
                  <p className="text-xs text-muted-foreground">
                    {mine ? t('you') : q.authorName} ·{' '}
                    {new Date(q.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </p>
                  {isHost && onStatus ? (
                    <div className="flex flex-wrap gap-1.5 pt-0.5">
                      {q.status === 'open' ? (
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          className="h-7 px-2 text-xs"
                          onClick={() => onStatus(q.id, 'live')}
                        >
                          <Mic className="h-3.5 w-3.5" />
                          {t('giveFloor')}
                        </Button>
                      ) : null}
                      {!done ? (
                        <Button
                          type="button"
                          size="sm"
                          className="h-7 bg-success px-2 text-xs text-success-foreground hover:bg-success/90"
                          onClick={() => onStatus(q.id, 'answered')}
                        >
                          <Check className="h-3.5 w-3.5" />
                          {t('markAnswered')}
                        </Button>
                      ) : (
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          className="h-7 px-2 text-xs"
                          onClick={() => onStatus(q.id, 'open')}
                        >
                          <RotateCcw className="h-3.5 w-3.5" />
                          {t('reopen')}
                        </Button>
                      )}
                    </div>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
