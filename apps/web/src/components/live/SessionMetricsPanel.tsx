'use client';

import { useQuery } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import type { LiveSessionMetrics } from '@lms/shared';
import { Users } from 'lucide-react';
import { api } from '@/lib/api/client';
import { cn } from '@/lib/utils';
import { Spinner } from '@/components/ui/spinner';

/**
 * Shared session performance panel for teacher live view and student workbook.
 * Shows roster + progress bars; never peer answer text.
 */
export function SessionMetricsPanel({
  sessionId,
  participant = false,
  pollMs = 5000,
}: {
  sessionId: string;
  participant?: boolean;
  pollMs?: number;
}) {
  const t = useTranslations('live');
  const query = useQuery({
    queryKey: ['session-live-metrics', sessionId, participant],
    queryFn: () =>
      api.get<LiveSessionMetrics>(`/sessions/${sessionId}/live-metrics`, {
        participant,
      }),
    enabled: !!sessionId,
    refetchInterval: pollMs,
  });

  if (query.isLoading) {
    return (
      <div className="flex justify-center py-4">
        <Spinner />
      </div>
    );
  }
  if (query.isError || !query.data) {
    return (
      <p className="text-sm text-muted-foreground">{t('metricsUnavailable')}</p>
    );
  }

  const data = query.data;
  const me = data.me;

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Users className="h-4 w-4 text-muted-foreground" />
        <h2 className="text-sm font-semibold">
          {t('sessionMetrics')}{' '}
          <span className="text-muted-foreground">
            ({data.totals.participants})
          </span>
        </h2>
      </div>

      <div className="grid grid-cols-3 gap-2 text-center">
        <MetricChip
          label={t('metricAttendance')}
          value={`${data.totals.attendanceScore}%`}
        />
        <MetricChip
          label={t('metricAvgProgress')}
          value={`${data.totals.avgProgress}%`}
        />
        <MetricChip
          label={t('metricStudents')}
          value={String(data.totals.participants)}
        />
      </div>

      {me ? (
        <div className="rounded-lg border border-primary/30 bg-primary/5 px-3 py-2">
          <div className="flex items-center justify-between text-sm">
            <span className="font-medium">{t('myProgress')}</span>
            <span className="tabular-nums">{me.progressPercent}%</span>
          </div>
          <ProgressTrack percent={me.progressPercent} />
        </div>
      ) : null}

      {data.roster.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('noParticipants')}</p>
      ) : (
        <ul className="max-h-64 space-y-2 overflow-y-auto">
          {data.roster.map((p) => (
            <li
              key={p.participantId}
              className={cn(
                'rounded-lg border px-3 py-2',
                me?.participantId === p.participantId && 'border-primary/40',
              )}
            >
              <div className="flex items-center justify-between gap-2 text-sm">
                <span className="truncate font-medium">{p.name}</span>
                <span className="shrink-0 tabular-nums text-muted-foreground">
                  {p.progressPercent}%
                </span>
              </div>
              <ProgressTrack percent={p.progressPercent} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function MetricChip({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border bg-muted/40 px-2 py-1.5">
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      <div className="text-sm font-semibold tabular-nums">{value}</div>
    </div>
  );
}

function ProgressTrack({ percent }: { percent: number }) {
  return (
    <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-muted">
      <div
        className={cn(
          'h-full rounded-full transition-[width] duration-300',
          percent >= 100
            ? 'bg-emerald-500'
            : percent > 0
              ? 'bg-primary'
              : 'bg-transparent',
        )}
        style={{ width: `${percent}%` }}
      />
    </div>
  );
}
