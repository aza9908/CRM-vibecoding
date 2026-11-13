'use client';

import * as React from 'react';
import { useTranslations } from 'next-intl';
import {
  AlertTriangle,
  Check,
  ChevronDown,
  Clock,
  Copy,
  Lightbulb,
  ListChecks,
  MessageCircleQuestion,
  Mic,
  Sparkles,
  ThumbsUp,
  TrendingUp,
  Users,
} from 'lucide-react';
import type { LessonAnalysis, LessonAnalysisReport } from '@lms/shared';
import { useLatestAnalysis, useLessonAnalyses } from '@/lib/api/lesson-analysis';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { cn } from '@/lib/utils';

type T = ReturnType<typeof useTranslations>;

const SUB_SCORES = ['clarity', 'structure', 'engagement', 'pace', 'practice'] as const;

function formatDuration(sec: number | null): string | null {
  if (sec == null || sec <= 0) return null;
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

/** Green from 7.5, amber from 5, red below — matches the pulse gauge. */
function scoreTone(score: number): string {
  if (score >= 7.5) return 'hsl(var(--success))';
  if (score >= 5) return 'hsl(var(--warning))';
  return 'hsl(var(--destructive))';
}

function ScoreRing({ score, label }: { score: number; label: string }) {
  const R = 42;
  const C = 2 * Math.PI * R;
  const shown = Math.round(score * 10) / 10;
  return (
    <div
      className="relative h-24 w-24 shrink-0"
      role="img"
      aria-label={`${label}: ${shown} / 10`}
    >
      <svg viewBox="0 0 100 100" className="h-full w-full -rotate-90">
        <circle cx="50" cy="50" r={R} fill="none" stroke="hsl(var(--muted))" strokeWidth="9" />
        <circle
          cx="50"
          cy="50"
          r={R}
          fill="none"
          stroke={scoreTone(score)}
          strokeWidth="9"
          strokeLinecap="round"
          strokeDasharray={C}
          strokeDashoffset={C * (1 - Math.min(10, Math.max(0, score)) / 10)}
          className="transition-[stroke-dashoffset] duration-700"
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-2xl font-bold leading-none tabular-nums">{shown}</span>
        <span className="mt-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
          {label}
        </span>
      </div>
    </div>
  );
}

function StampChip({ at }: { at?: string }) {
  if (!at) return null;
  return (
    <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-muted px-2 py-0.5 font-mono text-[11px] font-medium tabular-nums text-muted-foreground">
      <Clock className="h-3 w-3" aria-hidden />
      {at}
    </span>
  );
}

function SectionTitle({
  icon: Icon,
  children,
  className,
}: {
  icon: React.ComponentType<{ className?: string }>;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <h3 className={cn('flex items-center gap-2 text-sm font-semibold', className)}>
      <Icon className="h-4 w-4 shrink-0" />
      {children}
    </h3>
  );
}

/** Plain-text version of a report, for «Скопировать разбор». */
function reportAsText(a: LessonAnalysis, r: LessonAnalysisReport, t: T): string {
  const out: string[] = [];
  out.push(`${t('title')} — ${a.title}`);
  out.push('');
  out.push(r.summary);
  out.push('');
  out.push(
    `${t('overall')}: ${r.score.overall}/10 · ` +
      SUB_SCORES.map((k) => `${t(`scores.${k}`)} ${r.score[k]}`).join(' · '),
  );
  if (r.strengths.length) {
    out.push('', `${t('strengths')}:`);
    for (const s of r.strengths) out.push(`+ ${s.title}${s.at ? ` [${s.at}]` : ''} — ${s.evidence}`);
  }
  if (r.weaknesses.length) {
    out.push('', `${t('weaknesses')}:`);
    for (const w of r.weaknesses) {
      out.push(`- ${w.title}${w.at ? ` [${w.at}]` : ''} — ${w.evidence}`);
      out.push(`  ${t('howToFix')}: ${w.fix}`);
    }
  }
  if (r.recommendations.length) {
    out.push('', `${t('recommendations')}:`);
    r.recommendations.forEach((x, i) => out.push(`${i + 1}. ${x}`));
  }
  if (r.timeline.length) {
    out.push('', `${t('timeline')}:`);
    for (const x of r.timeline) out.push(`${x.from}–${x.to}  ${x.topic}${x.note ? ` — ${x.note}` : ''}`);
  }
  return out.join('\n');
}

/** The finished review. `wide` lays strengths / weaknesses side by side. */
export function LessonAnalysisReportView({
  analysis,
  wide,
}: {
  analysis: LessonAnalysis;
  wide?: boolean;
}) {
  const t = useTranslations('analysis');
  const r = analysis.report;
  const [showTranscript, setShowTranscript] = React.useState(false);
  const [copied, setCopied] = React.useState(false);
  if (!r) return null;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(reportAsText(analysis, r, t));
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      setCopied(false);
    }
  };
  const duration = formatDuration(analysis.durationSec);

  return (
    <div className="space-y-5" data-analysis-report>
      {/* Score */}
      <div className="flex flex-wrap items-center gap-4">
        <ScoreRing score={r.score.overall} label={t('outOf10')} />
        <div className="min-w-[12rem] flex-1 space-y-1.5">
          {SUB_SCORES.map((k) => (
            <div key={k} className="flex items-center gap-2 text-xs">
              <span className="w-28 shrink-0 truncate text-muted-foreground">{t(`scores.${k}`)}</span>
              <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
                <span
                  className="block h-full rounded-full transition-[width] duration-700"
                  style={{ width: `${r.score[k] * 10}%`, backgroundColor: scoreTone(r.score[k]) }}
                />
              </span>
              <span className="w-6 shrink-0 text-right font-semibold tabular-nums">{r.score[k]}</span>
            </div>
          ))}
        </div>
      </div>

      <p className="text-sm leading-relaxed">{r.summary}</p>

      {/* Strong / weak sides */}
      <div className={cn('grid gap-4', wide && 'md:grid-cols-2')}>
        <section className="space-y-2">
          <SectionTitle icon={ThumbsUp} className="text-success">
            {t('strengths')}
          </SectionTitle>
          {r.strengths.length === 0 ? (
            <p className="text-xs text-muted-foreground">{t('noStrengths')}</p>
          ) : (
            r.strengths.map((s, i) => (
              <article key={i} className="rounded-lg border border-success/30 bg-success/5 p-3">
                <div className="flex items-start justify-between gap-2">
                  <h4 className="text-sm font-semibold leading-snug">{s.title}</h4>
                  <StampChip at={s.at} />
                </div>
                <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{s.evidence}</p>
              </article>
            ))
          )}
        </section>
        <section className="space-y-2">
          <SectionTitle icon={TrendingUp} className="text-warning-foreground dark:text-warning">
            {t('weaknesses')}
          </SectionTitle>
          {r.weaknesses.length === 0 ? (
            <p className="text-xs text-muted-foreground">{t('noWeaknesses')}</p>
          ) : (
            r.weaknesses.map((w, i) => (
              <article key={i} className="rounded-lg border border-warning/40 bg-warning/5 p-3">
                <div className="flex items-start justify-between gap-2">
                  <h4 className="text-sm font-semibold leading-snug">{w.title}</h4>
                  <StampChip at={w.at} />
                </div>
                <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{w.evidence}</p>
                <p className="mt-2 flex gap-1.5 rounded-md bg-background/70 p-2 text-xs leading-relaxed">
                  <Lightbulb className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" aria-hidden />
                  <span>
                    <span className="font-semibold">{t('howToFix')}: </span>
                    {w.fix}
                  </span>
                </p>
              </article>
            ))
          )}
        </section>
      </div>

      {/* What to do next */}
      {r.recommendations.length > 0 ? (
        <section className="space-y-2 rounded-lg border border-primary/30 bg-primary/5 p-3">
          <SectionTitle icon={ListChecks} className="text-primary">
            {t('recommendations')}
          </SectionTitle>
          <ol className="space-y-1.5">
            {r.recommendations.map((x, i) => (
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

      {/* Engagement */}
      <section className="space-y-2">
        <SectionTitle icon={Users}>{t('engagement')}</SectionTitle>
        <div className="grid grid-cols-2 gap-2">
          {r.engagement.teacherTalkShare != null ? (
            <div className="rounded-lg border p-2.5">
              <p className="flex items-center gap-1.5 text-[11px] uppercase tracking-wide text-muted-foreground">
                <Mic className="h-3 w-3" aria-hidden /> {t('teacherTalk')}
              </p>
              <p className="text-lg font-bold tabular-nums">{r.engagement.teacherTalkShare}%</p>
            </div>
          ) : null}
          <div className="rounded-lg border p-2.5">
            <p className="flex items-center gap-1.5 text-[11px] uppercase tracking-wide text-muted-foreground">
              <MessageCircleQuestion className="h-3 w-3" aria-hidden /> {t('studentQuestions')}
            </p>
            <p className="text-lg font-bold tabular-nums">{r.engagement.studentQuestions}</p>
          </div>
        </div>
        {r.engagement.pulse ? (
          <p className="text-xs leading-relaxed text-muted-foreground">
            <span className="font-semibold text-foreground">{t('pulse')}: </span>
            {r.engagement.pulse}
          </p>
        ) : null}
        {r.engagement.passive && r.engagement.passive.length > 0 ? (
          <p className="flex flex-wrap items-center gap-1.5 text-xs">
            <span className="font-semibold">{t('passive')}:</span>
            {r.engagement.passive.map((name) => (
              <span key={name} className="rounded-full bg-muted px-2 py-0.5">
                {name}
              </span>
            ))}
          </p>
        ) : null}
      </section>

      {/* Timeline */}
      {r.timeline.length > 0 ? (
        <section className="space-y-2">
          <SectionTitle icon={Clock}>{t('timeline')}</SectionTitle>
          <ol className="space-y-1.5 border-l-2 border-muted pl-3">
            {r.timeline.map((x, i) => (
              <li key={i} className="text-sm leading-snug">
                <span className="mr-2 font-mono text-[11px] tabular-nums text-muted-foreground">
                  {x.from}–{x.to}
                </span>
                <span className="font-medium">{x.topic}</span>
                {x.note ? <span className="text-muted-foreground"> — {x.note}</span> : null}
              </li>
            ))}
          </ol>
        </section>
      ) : null}

      {/* Quotes */}
      {r.quotes && r.quotes.length > 0 ? (
        <section className="space-y-2">
          <SectionTitle icon={Sparkles}>{t('quotes')}</SectionTitle>
          {r.quotes.map((q, i) => (
            <blockquote key={i} className="border-l-2 border-primary/50 pl-3 text-sm italic leading-snug">
              «{q.text}» <StampChip at={q.at} />
            </blockquote>
          ))}
        </section>
      ) : null}

      {/* Footer */}
      <div className="flex flex-wrap items-center gap-2 border-t pt-3">
        <Button type="button" variant="outline" size="sm" onClick={() => void copy()}>
          {copied ? <Check /> : <Copy />}
          {copied ? t('copied') : t('copy')}
        </Button>
        {analysis.transcript ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => setShowTranscript((v) => !v)}
            aria-expanded={showTranscript}
          >
            <ChevronDown className={cn('transition-transform', showTranscript && 'rotate-180')} />
            {showTranscript ? t('hideTranscript') : t('showTranscript')}
          </Button>
        ) : null}
        {duration ? (
          <span className="ml-auto text-xs text-muted-foreground">
            {t('duration')}: {duration}
          </span>
        ) : null}
      </div>
      {showTranscript && analysis.transcript ? (
        <pre className="max-h-72 overflow-y-auto whitespace-pre-wrap rounded-lg bg-muted/50 p-3 font-sans text-xs leading-relaxed">
          {analysis.transcript}
        </pre>
      ) : null}
    </div>
  );
}

/** Progress, failure or the finished review of one analysis. */
function AnalysisBody({ analysis, wide }: { analysis: LessonAnalysis; wide?: boolean }) {
  const t = useTranslations('analysis');
  if (analysis.status === 'done' && analysis.report) {
    return <LessonAnalysisReportView analysis={analysis} wide={wide} />;
  }
  if (analysis.status === 'failed') {
    const key = `errors.${analysis.error ?? 'generic'}`;
    return (
      <div
        role="alert"
        className="flex gap-3 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm"
      >
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" aria-hidden />
        <div>
          <p className="font-semibold">{t('failedTitle')}</p>
          <p className="text-xs leading-relaxed text-muted-foreground">
            {t.has(key) ? t(key) : t('errors.generic')}
          </p>
        </div>
      </div>
    );
  }
  const stageKey = `stage.${analysis.stage}`;
  return (
    <div className="space-y-2" role="status" aria-live="polite">
      <p className="flex items-center gap-2 text-sm font-medium">
        <Spinner className="h-4 w-4" />
        {t.has(stageKey) ? t(stageKey) : t('stage.queued')}
        <span className="ml-auto tabular-nums text-muted-foreground">{analysis.progress}%</span>
      </p>
      <div className="h-2 overflow-hidden rounded-full bg-muted">
        <div
          className="h-full rounded-full bg-primary transition-[width] duration-700"
          style={{ width: `${Math.max(4, analysis.progress)}%` }}
        />
      </div>
      <p className="text-xs text-muted-foreground">{t('progressHint')}</p>
    </div>
  );
}

function Header({ analysis }: { analysis: LessonAnalysis }) {
  const t = useTranslations('analysis');
  return (
    <header className="flex items-start gap-3">
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
        <Sparkles className="h-4 w-4" aria-hidden />
      </span>
      <div className="min-w-0 flex-1">
        <h2 className="text-sm font-semibold">{t('title')}</h2>
        <p className="truncate text-xs text-muted-foreground">{analysis.title}</p>
      </div>
    </header>
  );
}

/**
 * «ИИ-разбор урока» of one live session: nothing until a recording has been
 * sent for analysis, then progress, then the review — strong sides, what to
 * improve, timeline, engagement, recommendations and the transcript.
 */
export function LessonAnalysisCard({
  sessionId,
  wide,
  className,
}: {
  sessionId: string | undefined;
  /** Two-column layout for full-width pages (off in the narrow live sidebar). */
  wide?: boolean;
  className?: string;
}) {
  const { data: analysis } = useLatestAnalysis(sessionId);
  if (!analysis) return null;
  return (
    <section
      data-analysis-card
      className={cn(
        'space-y-4 rounded-lg border border-primary/30 bg-card p-4 text-card-foreground shadow-sm',
        className,
      )}
    >
      <Header analysis={analysis} />
      <AnalysisBody analysis={analysis} wide={wide} />
    </section>
  );
}

/**
 * Every AI review of a lesson (one per recorded session), newest first —
 * for the lesson reports page. Renders nothing when there are none.
 */
export function LessonAnalysesList({
  lessonId,
  className,
}: {
  lessonId: string | undefined;
  className?: string;
}) {
  const t = useTranslations('analysis');
  const { data } = useLessonAnalyses(lessonId);
  const [open, setOpen] = React.useState<string | null>(null);
  if (!data || data.length === 0) return null;
  return (
    <section className={cn('space-y-3', className)} data-analysis-list>
      <h2 className="flex items-center gap-2 text-lg font-semibold">
        <Sparkles className="h-5 w-5 text-primary" aria-hidden />
        {t('listTitle')}
      </h2>
      {data.map((a, index) => {
        const expanded = open === a.id || (open === null && index === 0);
        const date = new Date(a.createdAt).toLocaleString(undefined, {
          day: 'numeric',
          month: 'long',
          hour: '2-digit',
          minute: '2-digit',
        });
        return (
          <article key={a.id} className="rounded-lg border bg-card text-card-foreground shadow-sm">
            <button
              type="button"
              onClick={() => setOpen(expanded ? '' : a.id)}
              aria-expanded={expanded}
              className="flex w-full items-center gap-3 rounded-lg p-4 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-semibold">{a.title}</span>
                <span className="block text-xs text-muted-foreground">{date}</span>
              </span>
              {a.status === 'done' && a.report ? (
                <span
                  className="rounded-full px-2.5 py-0.5 text-sm font-bold tabular-nums text-white"
                  style={{ backgroundColor: scoreTone(a.report.score.overall) }}
                >
                  {a.report.score.overall}
                </span>
              ) : a.status === 'failed' ? (
                <AlertTriangle className="h-4 w-4 text-destructive" aria-hidden />
              ) : (
                <Spinner className="h-4 w-4" />
              )}
              <ChevronDown
                className={cn('h-4 w-4 shrink-0 text-muted-foreground transition-transform', expanded && 'rotate-180')}
                aria-hidden
              />
            </button>
            {expanded ? (
              <div className="border-t p-4">
                <AnalysisBody analysis={a} wide />
              </div>
            ) : null}
          </article>
        );
      })}
    </section>
  );
}
