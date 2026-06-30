'use client';

import * as React from 'react';
import { useTranslations } from 'next-intl';
import { ArrowLeft, Download, Users, MessageSquare } from 'lucide-react';
import type { SessionStatus } from '@lms/shared';
import { Link } from '@/i18n/routing';
import {
  useLesson,
  useLessonSessions,
  downloadReportExport,
} from '@/lib/api/hooks';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';

function StatusBadge({ status }: { status: SessionStatus }) {
  const t = useTranslations('reports');
  const variant =
    status === 'live'
      ? 'success'
      : status === 'ended'
        ? 'secondary'
        : 'outline';
  return <Badge variant={variant}>{t(`status.${status}`)}</Badge>;
}

function formatDateTime(value?: string | null): string {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString();
}

/** Teacher reports landing for one lesson: a list of its sessions + export. */
export function ReportsListView({ lessonId }: { lessonId: string }) {
  const t = useTranslations('reports');
  const tc = useTranslations('common');

  const lessonQuery = useLesson(lessonId);
  const { data: sessions, isLoading, isError, refetch } =
    useLessonSessions(lessonId);

  const [exporting, setExporting] = React.useState<'csv' | 'json' | null>(null);
  const [exportError, setExportError] = React.useState<string | null>(null);

  const onExport = React.useCallback(
    async (format: 'csv' | 'json') => {
      setExportError(null);
      setExporting(format);
      try {
        await downloadReportExport(lessonId, format);
      } catch (err) {
        setExportError(
          err instanceof Error ? err.message : tc('error'),
        );
      } finally {
        setExporting(null);
      }
    },
    [lessonId, tc],
  );

  return (
    <>
      <div className="mb-6">
        <Button asChild variant="ghost" size="sm" className="-ml-2 mb-3">
          <Link href="/teacher/lessons">
            <ArrowLeft />
            {tc('back')}
          </Link>
        </Button>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">{t('title')}</h1>
            {lessonQuery.data?.title && (
              <p className="mt-1 text-muted-foreground">
                {lessonQuery.data.title}
              </p>
            )}
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              onClick={() => void onExport('csv')}
              disabled={exporting !== null}
            >
              {exporting === 'csv' ? <Spinner /> : <Download />}
              {t('exportCsv')}
            </Button>
            <Button
              variant="outline"
              onClick={() => void onExport('json')}
              disabled={exporting !== null}
            >
              {exporting === 'json' ? <Spinner /> : <Download />}
              {t('exportJson')}
            </Button>
          </div>
        </div>
        {exportError && (
          <p className="mt-3 text-sm text-destructive" role="alert">
            {exportError}
          </p>
        )}
      </div>

      {isLoading ? (
        <div className="flex items-center gap-2 text-muted-foreground">
          <Spinner />
          {tc('loading')}
        </div>
      ) : isError ? (
        <div className="flex flex-col items-start gap-3 rounded-lg border bg-card p-6 shadow-sm">
          <p className="text-destructive">{tc('error')}</p>
          <Button variant="outline" onClick={() => void refetch()}>
            {tc('retry')}
          </Button>
        </div>
      ) : !sessions || sessions.length === 0 ? (
        <div className="flex items-center justify-center rounded-lg border border-dashed bg-card/50 p-16 text-center">
          <p className="text-muted-foreground">{t('noSessions')}</p>
        </div>
      ) : (
        <div className="space-y-3">
          {sessions.map((s) => (
            <Link
              key={s.id}
              href={`/teacher/lessons/${lessonId}/reports/${s.id}`}
              className="block"
            >
              <Card className="flex flex-wrap items-center gap-x-6 gap-y-3 p-4 transition-shadow hover:shadow-md">
                <div className="flex items-center gap-3">
                  <span className="font-mono text-lg font-semibold tracking-wider">
                    {s.code}
                  </span>
                  <StatusBadge status={s.status} />
                </div>
                <div className="flex items-center gap-5 text-sm text-muted-foreground">
                  <span className="inline-flex items-center gap-1.5">
                    <Users className="h-4 w-4" />
                    {s.participantCount}
                  </span>
                  <span className="inline-flex items-center gap-1.5">
                    <MessageSquare className="h-4 w-4" />
                    {s.responseCount}
                  </span>
                </div>
                <span className="ml-auto text-sm text-muted-foreground">
                  {formatDateTime(s.startTime ?? s.createdAt)}
                </span>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </>
  );
}
