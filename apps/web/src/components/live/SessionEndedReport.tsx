'use client';

import * as React from 'react';
import { useTranslations } from 'next-intl';
import { Download, FileSpreadsheet } from 'lucide-react';
import { Link } from '@/i18n/routing';
import {
  downloadReportExport,
  useSessionReport,
} from '@/lib/api/hooks/use-reports';
import { Brand } from '@/components/brand';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Spinner } from '@/components/ui/spinner';
import { Badge } from '@/components/ui/badge';
import {
  Donut,
  HorizontalBars,
  studentColor,
  type BarDatum,
  type DonutDatum,
} from '@/components/reports/charts';

/**
 * Post-session teacher report: KPIs, charts, per-student progress, Excel.
 */
export function SessionEndedReport({
  sessionId,
  lessonId,
}: {
  sessionId: string;
  lessonId: string | null | undefined;
}) {
  const t = useTranslations('live');
  const tr = useTranslations('reports');
  const tc = useTranslations('common');
  const reportQuery = useSessionReport(sessionId);
  const [exporting, setExporting] = React.useState(false);
  const [exportError, setExportError] = React.useState<string | null>(null);

  const report = reportQuery.data;

  const onExport = React.useCallback(async () => {
    if (!lessonId) return;
    setExporting(true);
    setExportError(null);
    try {
      await downloadReportExport(lessonId, 'xlsx', sessionId);
    } catch {
      setExportError(t('exportFailed'));
    } finally {
      setExporting(false);
    }
  }, [lessonId, sessionId, t]);

  const progressBars: BarDatum[] = React.useMemo(
    () =>
      (report?.byParticipant ?? [])
        .slice()
        .sort((a, b) => b.progressPercent - a.progressPercent)
        .map((p, i) => ({
          label: p.participant.name,
          value: p.progressPercent,
          color: studentColor(i),
        })),
    [report],
  );

  const completionMix: DonutDatum[] = React.useMemo(() => {
    const list = report?.byParticipant ?? [];
    const completed = list.filter((p) => p.progressPercent >= 100).length;
    const inProgress = list.filter(
      (p) => p.progressPercent > 0 && p.progressPercent < 100,
    ).length;
    const notStarted = list.filter((p) => p.progressPercent === 0).length;
    return [
      { label: tr('completed'), value: completed },
      { label: tr('inProgress'), value: inProgress },
      { label: tr('notStarted'), value: notStarted },
    ].filter((d) => d.value > 0);
  }, [report, tr]);

  if (reportQuery.isLoading) {
    return (
      <main className="container flex min-h-screen items-center justify-center">
        <Spinner className="h-6 w-6" label={tc('loading')} />
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-background">
      <header className="border-b bg-card/80 backdrop-blur">
        <div className="container flex flex-wrap items-center gap-4 py-4">
          <Brand />
          <div className="min-w-0">
            <h1 className="text-lg font-semibold">{t('sessionEnded')}</h1>
            <p className="text-sm text-muted-foreground">
              {t('endedReportHint')}
              {report?.session.code ? ` · ${report.session.code}` : ''}
            </p>
          </div>
          <div className="ml-auto flex flex-wrap items-center gap-2">
            <Button
              type="button"
              onClick={() => void onExport()}
              disabled={!lessonId || exporting}
            >
              {exporting ? (
                <Spinner className="h-4 w-4" />
              ) : (
                <FileSpreadsheet className="h-4 w-4" />
              )}
              {t('downloadExcel')}
            </Button>
            {lessonId && (
              <Button asChild variant="outline">
                <Link href={`/teacher/lessons/${lessonId}/reports/${sessionId}`}>
                  <Download className="h-4 w-4" />
                  {t('openFullReport')}
                </Link>
              </Button>
            )}
            <Button asChild variant="secondary">
              <Link href="/teacher/lessons">{tc('back')}</Link>
            </Button>
          </div>
        </div>
      </header>

      <div className="container space-y-6 py-6">
        {exportError && (
          <p className="text-sm text-destructive">{exportError}</p>
        )}

        {report && (
          <>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <Kpi label={tr('kpiParticipants')} value={report.totals.participants} />
              <Kpi label={tr('kpiResponses')} value={report.totals.responses} />
              <Kpi
                label={tr('kpiAvgProgress')}
                value={`${report.totals.avgProgress}%`}
              />
              <Kpi
                label={tr('kpiAttendance')}
                value={`${report.totals.attendanceScore}%`}
              />
            </div>

            <div className="grid gap-4 lg:grid-cols-2">
              <Card className="p-5">
                <h2 className="mb-3 text-sm font-semibold">
                  {tr('completionByStudent')}
                </h2>
                {progressBars.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    {tr('noStudents')}
                  </p>
                ) : (
                  <HorizontalBars data={progressBars} />
                )}
              </Card>
              <Card className="p-5">
                <h2 className="mb-3 text-sm font-semibold">
                  {tr('completionMix')}
                </h2>
                {completionMix.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    {tr('noStudents')}
                  </p>
                ) : (
                  <Donut data={completionMix} />
                )}
              </Card>
            </div>

            <Card className="p-5">
              <h2 className="mb-4 text-sm font-semibold">
                {tr('completionByStudent')}
              </h2>
              {report.byParticipant.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  {tr('noStudents')}
                </p>
              ) : (
                <ul className="divide-y">
                  {report.byParticipant
                    .slice()
                    .sort((a, b) => b.progressPercent - a.progressPercent)
                    .map((p, i) => {
                      const answered = p.answers.filter((a) => a.isCompleted)
                        .length;
                      return (
                        <li
                          key={p.participant.id}
                          className="flex flex-wrap items-center gap-x-4 gap-y-2 py-3"
                        >
                          <span
                            className="h-3 w-3 shrink-0 rounded-full"
                            style={{ backgroundColor: studentColor(i) }}
                            aria-hidden
                          />
                          <span className="font-medium">
                            {p.participant.name}
                          </span>
                          <span className="text-sm text-muted-foreground">
                            {tr('answeredCount', {
                              answered,
                              total: p.answers.length,
                            })}
                          </span>
                          <Badge
                            variant={
                              p.progressPercent >= 100
                                ? 'success'
                                : p.progressPercent > 0
                                  ? 'default'
                                  : 'secondary'
                            }
                            className="ml-auto"
                          >
                            {p.progressPercent}%
                          </Badge>
                        </li>
                      );
                    })}
                </ul>
              )}
            </Card>
          </>
        )}
      </div>
    </main>
  );
}

function Kpi({ label, value }: { label: string; value: string | number }) {
  return (
    <Card className="p-4">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 text-2xl font-semibold tracking-tight">{value}</p>
    </Card>
  );
}
