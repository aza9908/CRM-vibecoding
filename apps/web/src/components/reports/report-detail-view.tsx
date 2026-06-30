'use client';

import * as React from 'react';
import { useTranslations } from 'next-intl';
import { ArrowLeft, Download } from 'lucide-react';
import type {
  SessionReportParticipant,
  SessionReportBlock,
  RatingMetric,
  TestMetric,
} from '@lms/shared';
import { Link } from '@/i18n/routing';
import { useSessionReport, downloadReportExport } from '@/lib/api/hooks';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { KpiCard } from './kpi-card';
import { Tabs } from './tabs';
import {
  Donut,
  HorizontalBars,
  VerticalBars,
  type BarDatum,
  type DonutDatum,
} from './charts';

type TabValue = 'students' | 'blocks' | 'metrics' | 'ratings';

function ProgressBadge({ percent }: { percent: number }) {
  const variant =
    percent >= 100 ? 'success' : percent > 0 ? 'default' : 'secondary';
  return <Badge variant={variant}>{percent}%</Badge>;
}

// ── Tab: Students ──────────────────────────────────────────────────────────
function StudentsTab({
  byParticipant,
}: {
  byParticipant: SessionReportParticipant[];
}) {
  const t = useTranslations('reports');

  if (byParticipant.length === 0) {
    return <p className="text-sm text-muted-foreground">{t('noStudents')}</p>;
  }

  const bars: BarDatum[] = byParticipant.map((p) => ({
    label: p.participant.name,
    value: p.progressPercent,
  }));

  return (
    <div className="space-y-6">
      <Card className="p-5">
        <h3 className="mb-3 text-sm font-semibold">{t('completionByStudent')}</h3>
        <HorizontalBars data={bars} />
      </Card>
      <div className="space-y-2">
        {byParticipant.map((p) => {
          const answered = p.answers.filter((a) => a.isCompleted).length;
          return (
            <Card
              key={p.participant.id}
              className="flex flex-wrap items-center gap-x-6 gap-y-2 p-4"
            >
              <span className="font-medium">{p.participant.name}</span>
              <span className="text-sm text-muted-foreground">
                {t('answeredCount', {
                  answered,
                  total: p.answers.length,
                })}
              </span>
              <span className="ml-auto">
                <ProgressBadge percent={p.progressPercent} />
              </span>
            </Card>
          );
        })}
      </div>
    </div>
  );
}

// ── Tab: By block / question ───────────────────────────────────────────────
function BlocksTab({ byBlock }: { byBlock: SessionReportBlock[] }) {
  const t = useTranslations('reports');

  if (byBlock.length === 0) {
    return <p className="text-sm text-muted-foreground">{t('noResponses')}</p>;
  }

  return (
    <div className="space-y-4">
      {byBlock.map((b) => (
        <Card key={b.block.id} className="p-5">
          <div className="mb-3 flex items-start justify-between gap-3">
            <h3 className="text-sm font-semibold">
              {b.block.content?.trim() || t('untitledBlock')}
            </h3>
            <Badge variant="outline" className="shrink-0">
              {b.responses.length}
            </Badge>
          </div>
          {b.responses.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('noResponses')}</p>
          ) : (
            <ul className="space-y-1.5">
              {b.responses.map((r, i) => (
                <li
                  key={`${b.block.id}:${i}`}
                  className="flex flex-col rounded-md bg-muted/50 px-3 py-2 text-sm"
                >
                  <span className="text-xs font-medium text-muted-foreground">
                    {r.participant ?? '—'}
                  </span>
                  <span className="whitespace-pre-wrap break-words">
                    {r.answer ?? '—'}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      ))}
    </div>
  );
}

// ── Tab: Metrics ───────────────────────────────────────────────────────────
function MetricsTab({
  byParticipant,
  tests,
}: {
  byParticipant: SessionReportParticipant[];
  tests: TestMetric[];
}) {
  const t = useTranslations('reports');

  // Completion distribution computed only for the donut categorization — the
  // underlying progress percents themselves come from the API.
  const completed = byParticipant.filter((p) => p.progressPercent >= 100).length;
  const inProgress = byParticipant.filter(
    (p) => p.progressPercent > 0 && p.progressPercent < 100,
  ).length;
  const notStarted = byParticipant.filter((p) => p.progressPercent === 0).length;

  const donut: DonutDatum[] = [
    { label: t('completed'), value: completed, color: '#10b981' },
    { label: t('inProgress'), value: inProgress, color: '#f59e0b' },
    { label: t('notStarted'), value: notStarted, color: '#64748b' },
  ];

  const hasParticipants = byParticipant.length > 0;

  return (
    <div className="space-y-6">
      <Card className="p-5">
        <h3 className="mb-4 text-sm font-semibold">{t('completionMix')}</h3>
        {hasParticipants ? (
          <Donut data={donut} centerLabel={t('students')} />
        ) : (
          <p className="text-sm text-muted-foreground">{t('noStudents')}</p>
        )}
      </Card>

      <Card className="p-5">
        <h3 className="mb-4 text-sm font-semibold">{t('testMetrics')}</h3>
        {tests.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('noTests')}</p>
        ) : (
          <ul className="space-y-3">
            {tests.map((tm) => (
              <li key={tm.blockId} className="space-y-1.5">
                <div className="flex items-center justify-between gap-3 text-sm">
                  <span className="font-medium">
                    {tm.content?.trim() || t('untitledBlock')}
                  </span>
                  <span className="shrink-0 tabular-nums text-muted-foreground">
                    {t('correctOf', { correct: tm.correct, total: tm.total })}
                  </span>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full rounded-full bg-primary"
                    style={{ width: `${Math.min(100, tm.correctPercent)}%` }}
                  />
                </div>
                <span className="text-xs text-muted-foreground tabular-nums">
                  {tm.correctPercent}% {t('correctPercent')}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

// ── Tab: Ratings ───────────────────────────────────────────────────────────
function RatingsTab({ ratings }: { ratings: RatingMetric[] }) {
  const t = useTranslations('reports');

  if (ratings.length === 0) {
    return <p className="text-sm text-muted-foreground">{t('noRatings')}</p>;
  }

  return (
    <div className="space-y-4">
      {ratings.map((rm) => {
        const data: BarDatum[] = Object.entries(rm.distribution)
          .sort(([a], [b]) => Number(a) - Number(b))
          .map(([value, count]) => ({ label: value, value: count }));
        return (
          <Card key={rm.blockId} className="p-5">
            <div className="mb-3 flex items-start justify-between gap-3">
              <h3 className="text-sm font-semibold">
                {rm.content?.trim() || t('untitledBlock')}
              </h3>
              <div className="shrink-0 text-right">
                <div className="text-2xl font-bold tabular-nums">
                  {rm.average.toFixed(1)}
                </div>
                <div className="text-xs text-muted-foreground">
                  {t('avgRating', { count: rm.count })}
                </div>
              </div>
            </div>
            <VerticalBars data={data} />
          </Card>
        );
      })}
    </div>
  );
}

/** Full session report with the 4 reporting tabs (docs/09 §4). */
export function ReportDetailView({
  lessonId,
  sessionId,
}: {
  lessonId: string;
  sessionId: string;
}) {
  const t = useTranslations('reports');
  const tc = useTranslations('common');
  const [tab, setTab] = React.useState<TabValue>('students');
  const [exporting, setExporting] = React.useState(false);
  const [exportError, setExportError] = React.useState<string | null>(null);

  const { data: report, isLoading, isError, refetch } =
    useSessionReport(sessionId);

  const onExport = React.useCallback(async () => {
    setExportError(null);
    setExporting(true);
    try {
      await downloadReportExport(lessonId, 'csv');
    } catch (err) {
      setExportError(err instanceof Error ? err.message : tc('error'));
    } finally {
      setExporting(false);
    }
  }, [lessonId, tc]);

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 text-muted-foreground">
        <Spinner />
        {tc('loading')}
      </div>
    );
  }

  if (isError || !report) {
    return (
      <div className="flex flex-col items-start gap-3 rounded-lg border bg-card p-6 shadow-sm">
        <p className="text-destructive">{tc('error')}</p>
        <Button variant="outline" onClick={() => void refetch()}>
          {tc('retry')}
        </Button>
      </div>
    );
  }

  const tabs = [
    { value: 'students' as const, label: t('tabStudents') },
    { value: 'blocks' as const, label: t('tabBlocks') },
    { value: 'metrics' as const, label: t('tabMetrics') },
    { value: 'ratings' as const, label: t('tabRatings') },
  ];

  return (
    <>
      <div className="mb-6">
        <Button asChild variant="ghost" size="sm" className="-ml-2 mb-3">
          <Link href={`/teacher/lessons/${lessonId}/reports`}>
            <ArrowLeft />
            {tc('back')}
          </Link>
        </Button>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="flex items-center gap-3 text-3xl font-bold tracking-tight">
              <span className="font-mono tracking-wider">
                {report.session.code}
              </span>
            </h1>
            <p className="mt-1 text-muted-foreground">{t('subtitle')}</p>
          </div>
          <Button
            variant="outline"
            onClick={() => void onExport()}
            disabled={exporting}
          >
            {exporting ? <Spinner /> : <Download />}
            {t('exportCsv')}
          </Button>
        </div>
        {exportError && (
          <p className="mt-3 text-sm text-destructive" role="alert">
            {exportError}
          </p>
        )}
      </div>

      <div className="mb-6 grid gap-4 sm:grid-cols-3">
        <KpiCard label={t('kpiParticipants')} value={report.totals.participants} />
        <KpiCard label={t('kpiResponses')} value={report.totals.responses} />
        <KpiCard
          label={t('kpiAvgProgress')}
          value={`${report.totals.avgProgress}%`}
        />
      </div>

      <Tabs items={tabs} value={tab} onChange={(v) => setTab(v as TabValue)} />

      <div className="mt-6">
        {tab === 'students' && (
          <StudentsTab byParticipant={report.byParticipant} />
        )}
        {tab === 'blocks' && <BlocksTab byBlock={report.byBlock} />}
        {tab === 'metrics' && (
          <MetricsTab
            byParticipant={report.byParticipant}
            tests={report.tests ?? []}
          />
        )}
        {tab === 'ratings' && <RatingsTab ratings={report.ratings ?? []} />}
      </div>
    </>
  );
}
