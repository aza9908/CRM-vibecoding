'use client';

import * as React from 'react';
import { useTranslations } from 'next-intl';
import {
  Users,
  Activity,
  TrendingUp,
  CheckCircle2,
} from 'lucide-react';
import { useCompanyStats } from '@/lib/api/hooks';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { Card } from '@/components/ui/card';
import { KpiCard } from './kpi-card';
import { Donut, type DonutDatum } from './charts';

/**
 * Company analytics dashboard (admin / team_lead). Renders the pre-aggregated
 * `GET /analytics/company` payload only — KPI tiles plus an engagement donut.
 * It never recomputes analytics; the donut just splits the org headcount into
 * the active/inactive counts the API already returned.
 */
export function CompanyDashboardView() {
  const t = useTranslations('analytics');
  const tc = useTranslations('common');
  const { data: stats, isLoading, isError, refetch } = useCompanyStats();

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 text-muted-foreground">
        <Spinner />
        {tc('loading')}
      </div>
    );
  }

  if (isError || !stats) {
    return (
      <div className="flex flex-col items-start gap-3 rounded-lg border bg-card p-6 shadow-sm">
        <p className="text-destructive">{tc('error')}</p>
        <Button variant="outline" onClick={() => void refetch()}>
          {tc('retry')}
        </Button>
      </div>
    );
  }

  const inactive = Math.max(0, stats.totalStudents - stats.active30d);
  const engagement: DonutDatum[] = [
    { label: t('active'), value: stats.active30d, color: '#10b981' },
    { label: t('inactive'), value: inactive, color: '#64748b' },
  ];

  const activeRate =
    stats.totalStudents > 0
      ? Math.round((stats.active30d / stats.totalStudents) * 100)
      : 0;

  return (
    <>
      <div className="mb-8">
        <h1 className="text-3xl font-bold tracking-tight">{t('title')}</h1>
        <p className="mt-1 text-muted-foreground">{t('subtitle')}</p>
      </div>

      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard
          label={t('totalStudents')}
          value={stats.totalStudents}
          icon={Users}
        />
        <KpiCard
          label={t('active30d')}
          value={stats.active30d}
          hint={t('activeRate', { rate: activeRate })}
          icon={Activity}
        />
        <KpiCard
          label={t('avgProgress')}
          value={`${stats.avgProgress}%`}
          icon={TrendingUp}
        />
        <KpiCard
          label={t('completedLessons')}
          value={stats.completedLessons}
          icon={CheckCircle2}
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="p-5">
          <h3 className="mb-4 text-sm font-semibold">{t('engagement')}</h3>
          {stats.totalStudents > 0 ? (
            <Donut data={engagement} centerLabel={t('students')} />
          ) : (
            <p className="text-sm text-muted-foreground">{tc('empty')}</p>
          )}
        </Card>

        <Card className="p-5">
          <h3 className="mb-4 text-sm font-semibold">{t('avgProgress')}</h3>
          <div className="flex h-44 flex-col justify-center gap-4">
            <div className="space-y-1.5">
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">{t('avgProgress')}</span>
                <span className="font-semibold tabular-nums">
                  {stats.avgProgress}%
                </span>
              </div>
              <div className="h-2.5 overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full rounded-full bg-primary"
                  style={{ width: `${Math.min(100, stats.avgProgress)}%` }}
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">{t('activeShare')}</span>
                <span className="font-semibold tabular-nums">{activeRate}%</span>
              </div>
              <div className="h-2.5 overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full rounded-full bg-emerald-500"
                  style={{ width: `${Math.min(100, activeRate)}%` }}
                />
              </div>
            </div>
          </div>
        </Card>
      </div>
    </>
  );
}
