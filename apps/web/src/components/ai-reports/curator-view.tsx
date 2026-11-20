'use client';

import * as React from 'react';
import { useFormatter, useLocale, useTranslations } from 'next-intl';
import {
  AlertTriangle,
  Award,
  Bot,
  ChevronDown,
  ClipboardList,
  Mail,
  Minus,
  Printer,
  RotateCw,
  Sparkles,
  TrendingDown,
  TrendingUp,
  UserRoundX,
  Footprints,
} from 'lucide-react';
import type { CuratorReport, CuratorReportRecord } from '@lms/shared';
import { useCuratorReports, useStartCuratorReport } from '@/lib/api/ai-reports';
import { ApiError } from '@/lib/api/client';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Spinner } from '@/components/ui/spinner';
import { CompanyTile } from '@/components/rating/staff-rating-view';
import { cn } from '@/lib/utils';
import { AiJobFailure, AiJobProgress, CopyButton, SectionTitle } from './ai-report-parts';

type T = ReturnType<typeof useTranslations>;

const who = (x: { learner: string; name?: string }) => x.name || x.learner;

/** When printing, only the report is on paper (no app chrome, no buttons). */
const PRINT_CSS = `@media print {
  body * { visibility: hidden !important; }
  [data-curator-print], [data-curator-print] * { visibility: visible !important; }
  [data-curator-print] { position: absolute; inset: 0 auto auto 0; width: 100%; padding: 0 12mm; }
  [data-curator-print] section, [data-curator-print] tr { break-inside: avoid; }
}`;

function reportAsText(category: string, r: CuratorReport, t: T): string {
  const out: string[] = [`${t('title')} — ${category}`, '', r.overview.summary, ''];
  out.push(`${t('attendance')}: ${r.overview.attendance}`);
  out.push(`${t('completion')}: ${r.overview.completion}`);
  out.push(`${t('engagement')}: ${r.overview.engagement}`);
  if (r.overview.trendNote) out.push(`${t(`trend.${r.overview.trend}`)}: ${r.overview.trendNote}`);
  if (r.atRisk.length) {
    out.push('', `${t('atRisk')}:`);
    for (const a of r.atRisk) out.push(`- ${who(a)}: ${a.reason} → ${a.nextStep}`);
  }
  if (r.topPerformers.length) {
    out.push('', `${t('top')}:`);
    for (const a of r.topPerformers) out.push(`- ${who(a)}: ${a.why}`);
  }
  if (r.trainerActions.length) {
    out.push('', `${t('actions')}:`);
    r.trainerActions.forEach((x, i) => out.push(`${i + 1}. ${x}`));
  }
  out.push('', `${t('hrMessage')}:`, r.hrMessage);
  return out.join('\n');
}

function Kpi({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="rounded-lg border bg-card p-3">
      <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="text-xl font-bold tabular-nums">{value}</p>
    </div>
  );
}

function TrendBadge({ trend }: { trend: CuratorReport['overview']['trend'] }) {
  const t = useTranslations('curator');
  const Icon = trend === 'up' ? TrendingUp : trend === 'down' ? TrendingDown : Minus;
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold',
        trend === 'up' && 'bg-success/15 text-success',
        trend === 'down' && 'bg-destructive/10 text-destructive',
        (trend === 'flat' || trend === 'unknown') && 'bg-muted text-muted-foreground',
      )}
    >
      <Icon className="h-3.5 w-3.5" aria-hidden />
      {t(`trend.${trend}`)}
    </span>
  );
}

/** The finished curator report (print-friendly). */
function CuratorReportView({ record }: { record: CuratorReportRecord }) {
  const t = useTranslations('curator');
  const format = useFormatter();
  const r = record.report;
  const [allSteps, setAllSteps] = React.useState(false);
  if (!r) return null;
  const s = record.stats;
  const steps = allSteps ? r.learnerSteps : r.learnerSteps.slice(0, 15);
  const date = (iso: string | null) =>
    iso ? format.dateTime(new Date(iso), { day: 'numeric', month: 'short', year: 'numeric' }) : '—';

  return (
    <div className="space-y-6" data-curator-report>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-xl font-semibold">
          {t('reportFor', { company: record.category })}
        </h2>
        {record.finishedAt ? (
          <span className="text-xs text-muted-foreground">
            {t('generatedAt', { date: format.dateTime(new Date(record.finishedAt), { dateStyle: 'medium', timeStyle: 'short' }) })}
          </span>
        ) : null}
      </div>

      {s ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          <Kpi label={t('kpi.learners')} value={s.learners} />
          <Kpi label={t('kpi.lessons')} value={s.lessons} />
          <Kpi label={t('kpi.attendance')} value={`${s.attendanceRate}%`} />
          <Kpi label={t('kpi.required')} value={s.requiredRate == null ? '—' : `${s.requiredRate}%`} />
          <Kpi label={t('kpi.active30d')} value={s.active30d} />
        </div>
      ) : null}
      {s ? (
        <p className="text-xs text-muted-foreground">
          {t('period', { from: date(s.firstLessonAt), to: date(s.lastLessonAt) })}
          {s.analysesUsed ? ` · ${t('analysesUsed', { count: s.analysesUsed })}` : ''}
        </p>
      ) : null}

      <section className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <SectionTitle icon={ClipboardList}>{t('overview')}</SectionTitle>
          <TrendBadge trend={r.overview.trend} />
        </div>
        <p className="text-sm leading-relaxed">{r.overview.summary}</p>
        <div className="grid gap-3 md:grid-cols-3">
          {(['attendance', 'completion', 'engagement'] as const).map((k) => (
            <div key={k} className="rounded-lg border p-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t(k)}</p>
              <p className="mt-1 text-sm leading-relaxed">{r.overview[k]}</p>
            </div>
          ))}
        </div>
        {r.overview.trendNote ? (
          <p className="text-xs leading-relaxed text-muted-foreground">
            <span className="font-semibold text-foreground">{t('trendLabel')}: </span>
            {r.overview.trendNote}
          </p>
        ) : null}
      </section>

      <div className="grid gap-4 lg:grid-cols-[1fr_20rem]">
        <section className="space-y-2 rounded-lg border border-warning/40 bg-warning/5 p-3">
          <SectionTitle icon={UserRoundX} className="text-warning-foreground dark:text-warning">
            {t('atRisk')}
          </SectionTitle>
          {r.atRisk.length === 0 ? (
            <p className="text-xs text-muted-foreground">{t('nobodyAtRisk')}</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-left text-xs uppercase text-muted-foreground">
                  <tr>
                    <th className="py-1.5 pr-3 font-medium">{t('colLearner')}</th>
                    <th className="py-1.5 pr-3 font-medium">{t('colReason')}</th>
                    <th className="py-1.5 font-medium">{t('colNextStep')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-warning/20">
                  {r.atRisk.map((a) => (
                    <tr key={a.learner} className="align-top">
                      <td className="py-2 pr-3 font-semibold">{who(a)}</td>
                      <td className="py-2 pr-3 text-muted-foreground">{a.reason}</td>
                      <td className="py-2">{a.nextStep}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
        <section className="space-y-2 rounded-lg border border-success/30 bg-success/5 p-3">
          <SectionTitle icon={Award} className="text-success">
            {t('top')}
          </SectionTitle>
          {r.topPerformers.length === 0 ? (
            <p className="text-xs text-muted-foreground">—</p>
          ) : (
            <ul className="space-y-1.5">
              {r.topPerformers.map((a) => (
                <li key={a.learner} className="text-sm leading-snug">
                  <span className="font-semibold">{who(a)}</span>
                  <span className="text-muted-foreground"> — {a.why}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      {r.trainerActions.length > 0 ? (
        <section className="space-y-2 rounded-lg border border-primary/30 bg-primary/5 p-3">
          <SectionTitle icon={Sparkles} className="text-primary">
            {t('actions')}
          </SectionTitle>
          <ol className="space-y-1.5">
            {r.trainerActions.map((x, i) => (
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

      <section className="space-y-2 rounded-lg border p-3">
        <div className="flex flex-wrap items-center gap-2">
          <SectionTitle icon={Mail}>{t('hrMessage')}</SectionTitle>
          <span className="text-xs text-muted-foreground">{t('hrMessageHint')}</span>
          <CopyButton className="ml-auto" text={() => r.hrMessage} label={t('copyHr')} doneLabel={t('copied')} />
        </div>
        <p className="whitespace-pre-wrap rounded-md bg-muted/50 p-3 text-sm leading-relaxed">{r.hrMessage}</p>
      </section>

      {r.learnerSteps.length > 0 ? (
        <section className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <SectionTitle icon={Footprints}>{t('steps')}</SectionTitle>
            <CopyButton
              className="ml-auto"
              text={() => r.learnerSteps.map((x) => `${who(x)}: ${x.step}`).join('\n')}
              label={t('copySteps')}
              doneLabel={t('copied')}
            />
          </div>
          <ul className="divide-y rounded-lg border">
            {steps.map((x) => (
              <li key={x.learner} className="flex gap-3 p-2.5 text-sm">
                <span className="w-44 shrink-0 truncate font-medium">{who(x)}</span>
                <span className="text-muted-foreground">{x.step}</span>
              </li>
            ))}
          </ul>
          {r.learnerSteps.length > 15 ? (
            <Button type="button" variant="ghost" size="sm" onClick={() => setAllSteps((v) => !v)} className="print:hidden">
              <ChevronDown className={cn('transition-transform', allSteps && 'rotate-180')} />
              {allSteps ? t('showLess') : t('showAll', { count: r.learnerSteps.length })}
            </Button>
          ) : null}
        </section>
      ) : null}

      <div className="flex flex-wrap items-center gap-2 border-t pt-3 print:hidden">
        <CopyButton text={() => reportAsText(record.category, r, t)} label={t('copyReport')} doneLabel={t('copied')} />
      </div>
    </div>
  );
}

/**
 * «ИИ-куратор» (staff): pick a company (lesson category, same tiles as the
 * rating), generate the report, follow its progress, read / copy / print it.
 */
export function CuratorView() {
  const t = useTranslations('curator');
  const locale = useLocale();
  const [category, setCategory] = React.useState<string | null>(null);
  const { data, isLoading, isError } = useCuratorReports(category);
  const start = useStartCuratorReport();
  const record = data?.report && data.report.category === category ? data.report : null;
  const running = record?.status === 'queued' || record?.status === 'processing';
  const startError =
    start.error instanceof ApiError && start.error.status === 429
      ? t('errors.too_many')
      : start.error
        ? t('errors.start')
        : null;

  return (
    <div className="space-y-6">
      <style>{PRINT_CSS}</style>
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-semibold">
          <Bot className="h-6 w-6 text-primary" aria-hidden />
          {t('title')}
        </h1>
        <p className="mt-1 max-w-3xl text-sm text-muted-foreground">{t('subtitle')}</p>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-16">
          <Spinner />
        </div>
      ) : isError ? (
        <p className="py-12 text-center text-sm text-muted-foreground">{t('loadError')}</p>
      ) : !data || data.categories.length === 0 ? (
        <Card>
          <CardContent className="px-6 py-12 text-center">
            <p className="font-medium">{t('noCompanies')}</p>
            <p className="mt-1 text-sm text-muted-foreground">{t('noCompaniesHint')}</p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4" role="tablist">
          {data.categories.map((c) => (
            <CompanyTile
              key={c.name}
              active={category === c.name}
              onClick={() => setCategory((cur) => (cur === c.name ? null : c.name))}
              label={c.name}
              count={c.learners}
            />
          ))}
        </div>
      )}

      {category ? (
        <Card>
          <CardContent className="space-y-4 p-4 sm:p-6">
            <div className="flex flex-wrap items-center gap-2 print:hidden">
              <p className="mr-auto text-sm text-muted-foreground">{t('companyHint', { company: category })}</p>
              {record?.status === 'done' ? (
                <Button type="button" variant="outline" size="sm" onClick={() => window.print()}>
                  <Printer />
                  {t('print')}
                </Button>
              ) : null}
              <Button
                type="button"
                size="sm"
                variant={record?.status === 'done' ? 'outline' : 'default'}
                disabled={running || start.isPending}
                onClick={() => start.mutate({ category, locale })}
              >
                {start.isPending ? <Spinner className="h-4 w-4" /> : record ? <RotateCw /> : <Sparkles />}
                {record ? t('regenerate') : t('generate')}
              </Button>
            </div>
            {startError ? (
              <p role="alert" className="flex items-center gap-2 text-xs text-destructive">
                <AlertTriangle className="h-3.5 w-3.5" aria-hidden /> {startError}
              </p>
            ) : null}
            <div data-curator-print>
              {!record ? (
                <p className="text-sm text-muted-foreground">{t('empty')}</p>
              ) : record.status === 'done' && record.report ? (
                <CuratorReportView record={record} />
              ) : record.status === 'failed' ? (
                <AiJobFailure ns="curator" error={record.error} />
              ) : (
                <AiJobProgress ns="curator" stage={record.stage} progress={record.progress} />
              )}
            </div>
          </CardContent>
        </Card>
      ) : data && data.categories.length > 0 ? (
        <p className="text-sm text-muted-foreground">{t('pickCompany')}</p>
      ) : null}
    </div>
  );
}
