'use client';

import * as React from 'react';
import { useLocale, useTranslations } from 'next-intl';
import {
  AlertTriangle,
  ChevronDown,
  LifeBuoy,
  ListChecks,
  MessageSquareQuote,
  MessagesSquare,
  RotateCw,
  Sparkles,
} from 'lucide-react';
import type { AnswersAnalysis, AnswersReport } from '@lms/shared';
import { useAnswersAnalysis, useStartAnswersAnalysis } from '@/lib/api/ai-reports';
import { ApiError } from '@/lib/api/client';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { cn } from '@/lib/utils';
import { AiJobFailure, AiJobProgress, CopyButton, SectionTitle } from './ai-report-parts';

type T = ReturnType<typeof useTranslations>;

/** Who a label stands for: the real name the API mapped back, else the label. */
const who = (x: { participant: string; name?: string }) => x.name || x.participant;

/** Plain-text version of the report, for «Скопировать отчёт». */
function reportAsText(r: AnswersReport, t: T): string {
  const out: string[] = [t('title'), '', r.summary];
  if (r.teacherTips.length) {
    out.push('', `${t('tips')}:`);
    r.teacherTips.forEach((x, i) => out.push(`${i + 1}. ${x}`));
  }
  if (r.needHelp.length) {
    out.push('', `${t('needHelp')}:`);
    for (const n of r.needHelp) out.push(`- ${who(n)}: ${n.reason}`);
  }
  if (r.questions.length) {
    out.push('', `${t('questions')}:`);
    for (const q of r.questions) {
      out.push(`${q.ref}. ${q.title}${q.total ? ` (${q.answered ?? 0}/${q.total})` : ''}`);
      if (q.understood) out.push(`  ${q.understood}`);
      for (const m of q.mistakes) out.push(`  − ${m}`);
    }
  }
  if (r.feedback.length) {
    out.push('', `${t('feedback')}:`);
    for (const f of r.feedback) out.push(`${who(f)}: ${f.text}`);
  }
  return out.join('\n');
}

function QuestionItem({ q }: { q: AnswersReport['questions'][number] }) {
  const t = useTranslations('answersAnalysis');
  const [open, setOpen] = React.useState(false);
  const share = q.total ? Math.round(((q.answered ?? 0) / q.total) * 100) : null;
  return (
    <li className="rounded-lg border bg-card">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center gap-3 rounded-lg p-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <span className="flex h-6 min-w-[2rem] shrink-0 items-center justify-center rounded-full bg-muted px-2 font-mono text-[11px] font-semibold">
          {q.ref}
        </span>
        <span className="min-w-0 flex-1 truncate text-sm font-medium">{q.title}</span>
        {share != null ? (
          <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
            {t('answeredOf', { answered: q.answered ?? 0, total: q.total ?? 0 })}
          </span>
        ) : null}
        <ChevronDown
          className={cn('h-4 w-4 shrink-0 text-muted-foreground transition-transform print:hidden', open && 'rotate-180')}
          aria-hidden
        />
      </button>
      <div className={cn('space-y-2 border-t px-3 pb-3 pt-2 text-sm', !open && 'hidden print:block')}>
        {q.understood ? (
          <p className="leading-relaxed">
            <span className="font-semibold">{t('understood')}: </span>
            {q.understood}
          </p>
        ) : null}
        {q.mistakes.length > 0 ? (
          <div>
            <p className="font-semibold">{t('mistakes')}:</p>
            <ul className="ml-4 list-disc space-y-0.5 text-muted-foreground">
              {q.mistakes.map((m, i) => (
                <li key={i}>{m}</li>
              ))}
            </ul>
          </div>
        ) : null}
        {q.bestAnswers.length > 0 ? (
          <div className="space-y-1">
            <p className="font-semibold">{t('bestAnswers')}:</p>
            {q.bestAnswers.map((b, i) => (
              <blockquote key={i} className="border-l-2 border-success/60 pl-3 italic leading-snug">
                «{b.quote}» <span className="not-italic text-muted-foreground">— {who(b)}</span>
              </blockquote>
            ))}
          </div>
        ) : null}
        {!q.understood && q.mistakes.length === 0 && q.bestAnswers.length === 0 ? (
          <p className="text-xs text-muted-foreground">{t('noInsight')}</p>
        ) : null}
      </div>
    </li>
  );
}

/** The finished «ИИ-анализ ответов». */
export function AnswersReportView({ analysis }: { analysis: AnswersAnalysis }) {
  const t = useTranslations('answersAnalysis');
  const r = analysis.report;
  const [showAll, setShowAll] = React.useState(false);
  if (!r) return null;
  const s = analysis.stats;
  const feedback = showAll ? r.feedback : r.feedback.slice(0, 12);

  return (
    <div className="space-y-5" data-answers-report>
      {s ? (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {(
            [
              ['participants', s.participants],
              ['active', s.active],
              ['questionsCount', s.questions],
              ['answers', s.answers],
            ] as const
          ).map(([k, v]) => (
            <div key={k} className="rounded-lg border p-2.5">
              <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{t(`stats.${k}`)}</p>
              <p className="text-lg font-bold tabular-nums">{v}</p>
            </div>
          ))}
        </div>
      ) : null}

      <p className="text-sm leading-relaxed">{r.summary}</p>
      {s?.sampled ? <p className="text-xs text-muted-foreground">{t('sampledNote')}</p> : null}

      <div className="grid gap-4 md:grid-cols-2">
        {r.teacherTips.length > 0 ? (
          <section className="space-y-2 rounded-lg border border-primary/30 bg-primary/5 p-3">
            <SectionTitle icon={ListChecks} className="text-primary">
              {t('tips')}
            </SectionTitle>
            <ol className="space-y-1.5">
              {r.teacherTips.map((x, i) => (
                <li key={i} className="flex gap-2 text-sm leading-snug">
                  <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary text-[11px] font-bold text-primary-foreground">
                    {i + 1}
                  </span>
                  <span>{x}</span>
                </li>
              ))}
            </ol>
          </section>
        ) : null}
        <section className="space-y-2 rounded-lg border border-warning/40 bg-warning/5 p-3">
          <SectionTitle icon={LifeBuoy} className="text-warning-foreground dark:text-warning">
            {t('needHelp')}
          </SectionTitle>
          {r.needHelp.length === 0 ? (
            <p className="text-xs text-muted-foreground">{t('nobodyNeedsHelp')}</p>
          ) : (
            <ul className="space-y-1.5">
              {r.needHelp.map((n) => (
                <li key={n.participant} className="text-sm leading-snug">
                  <span className="font-semibold">{who(n)}</span>
                  <span className="text-muted-foreground"> — {n.reason}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      {r.questions.length > 0 ? (
        <section className="space-y-2">
          <SectionTitle icon={MessagesSquare}>{t('questions')}</SectionTitle>
          <ul className="space-y-2">
            {r.questions.map((q) => (
              <QuestionItem key={q.ref} q={q} />
            ))}
          </ul>
        </section>
      ) : null}

      {r.feedback.length > 0 ? (
        <section className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <SectionTitle icon={MessageSquareQuote}>{t('feedback')}</SectionTitle>
            <span className="text-xs text-muted-foreground">{t('feedbackHint')}</span>
            <CopyButton
              className="ml-auto"
              text={() => r.feedback.map((f) => `${who(f)}: ${f.text}`).join('\n\n')}
              label={t('copyAllFeedback')}
              doneLabel={t('copied')}
            />
          </div>
          <ul className="divide-y rounded-lg border">
            {feedback.map((f) => (
              <li key={f.participant} className="flex items-start gap-3 p-3">
                <div className="min-w-0 flex-1">
                  <p className="flex items-center gap-2 text-sm font-semibold">
                    {who(f)}
                    {f.needsHelp ? (
                      <span className="rounded-full bg-warning/15 px-2 py-0.5 text-[10px] font-medium text-warning-foreground dark:text-warning">
                        {t('needsHelpBadge')}
                      </span>
                    ) : null}
                  </p>
                  <p className="mt-0.5 text-sm leading-relaxed text-muted-foreground">{f.text}</p>
                </div>
                <CopyButton text={() => f.text} label={t('copy')} doneLabel={t('copied')} iconOnly />
              </li>
            ))}
          </ul>
          {r.feedback.length > feedback.length || showAll ? (
            <Button type="button" variant="ghost" size="sm" onClick={() => setShowAll((v) => !v)} className="print:hidden">
              <ChevronDown className={cn('transition-transform', showAll && 'rotate-180')} />
              {showAll ? t('showLess') : t('showAll', { count: r.feedback.length })}
            </Button>
          ) : null}
        </section>
      ) : null}

      <div className="flex flex-wrap items-center gap-2 border-t pt-3 print:hidden">
        <CopyButton text={() => reportAsText(r, t)} label={t('copyReport')} doneLabel={t('copied')} />
        {analysis.finishedAt ? (
          <span className="ml-auto text-xs text-muted-foreground">
            {t('generatedAt', { date: new Date(analysis.finishedAt).toLocaleString() })}
          </span>
        ) : null}
      </div>
    </div>
  );
}

/**
 * «ИИ-анализ ответов» of one live session: a start button, then progress,
 * then the report — group summary, tips, who needs help, per-question
 * insights and personal feedback with copy buttons. Staff pages only.
 */
export function AnswersAnalysisCard({
  sessionId,
  className,
}: {
  sessionId: string | undefined;
  className?: string;
}) {
  const t = useTranslations('answersAnalysis');
  const locale = useLocale();
  const { data: analysis, isLoading } = useAnswersAnalysis(sessionId);
  const start = useStartAnswersAnalysis(sessionId);
  const running = analysis?.status === 'queued' || analysis?.status === 'processing';
  const startError =
    start.error instanceof ApiError && start.error.status === 429 ? t('errors.too_many') : start.error ? t('errors.start') : null;

  return (
    <section
      data-answers-analysis-card
      className={cn(
        'space-y-4 rounded-lg border border-primary/30 bg-card p-4 text-card-foreground shadow-sm',
        className,
      )}
    >
      <header className="flex flex-wrap items-start gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
          <Sparkles className="h-4 w-4" aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-semibold">{t('title')}</h2>
          <p className="text-xs text-muted-foreground">{t('subtitle')}</p>
        </div>
        <Button
          type="button"
          size="sm"
          variant={analysis?.status === 'done' ? 'outline' : 'default'}
          disabled={!sessionId || running || start.isPending}
          onClick={() => start.mutate(locale)}
          className="print:hidden"
        >
          {start.isPending ? <Spinner className="h-4 w-4" /> : analysis ? <RotateCw /> : <Sparkles />}
          {analysis ? t('restart') : t('start')}
        </Button>
      </header>
      {startError ? (
        <p role="alert" className="flex items-center gap-2 text-xs text-destructive">
          <AlertTriangle className="h-3.5 w-3.5" aria-hidden /> {startError}
        </p>
      ) : null}

      {isLoading ? null : !analysis ? (
        <p className="text-sm text-muted-foreground">{t('empty')}</p>
      ) : analysis.status === 'done' && analysis.report ? (
        <AnswersReportView analysis={analysis} />
      ) : analysis.status === 'failed' ? (
        <AiJobFailure ns="answersAnalysis" error={analysis.error} />
      ) : (
        <AiJobProgress ns="answersAnalysis" stage={analysis.stage} progress={analysis.progress} />
      )}
    </section>
  );
}

