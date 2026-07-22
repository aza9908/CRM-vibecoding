'use client';

import { useTranslations } from 'next-intl';
import { BookMarked, Layers, TrendingUp, Wrench } from 'lucide-react';
import { useAuthStore } from '@/lib/store/auth-store';
import { useCurriculum } from '@/lib/api/hooks';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Spinner } from '@/components/ui/spinner';
import { KpiCard } from '@/components/reports/kpi-card';

const ROLE_LABEL_KEY = {
  teacher: 'roleTeacher',
  student: 'roleStudent',
  admin: 'roleAdmin',
  team_lead: 'roleTeamLead',
} as const;

/**
 * Кабинет — the personal landing page after login. Profile card up top,
 * then progress KPIs and a per-module breakdown derived from `/curriculum`.
 * Students get real per-lesson progress merged server-side; teachers/admins
 * see zeros (they don't have personal lesson progress) — same tree, same
 * component, no separate endpoint needed.
 */
export function CabinetView() {
  const t = useTranslations('cabinet');
  const ta = useTranslations('auth');
  const tc = useTranslations('common');
  const user = useAuthStore((s) => s.user);
  const { data, isLoading, isError } = useCurriculum();

  const modules = data?.modules ?? [];
  const allLessons = modules.flatMap((m) => m.lessons);
  const lessonsTotal = allLessons.length;
  const lessonsCompleted = allLessons.filter(
    (l) => l.progressStatus === 'completed',
  ).length;
  const inProgress = allLessons.filter(
    (l) => l.progressStatus === 'started',
  ).length;
  const overallPercent =
    modules.length > 0
      ? Math.round(
          modules.reduce((sum, m) => sum + m.progressPercent, 0) /
            modules.length,
        )
      : 0;

  const initial =
    user?.fullName?.trim()?.[0]?.toUpperCase() ??
    user?.email?.[0]?.toUpperCase() ??
    '?';

  return (
    <main className="container flex flex-col gap-6 py-8">
      <Card className="p-6">
        <div className="flex items-center gap-4">
          <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-primary text-xl font-semibold text-primary-foreground">
            {initial}
          </span>
          <div className="flex flex-col gap-1">
            <div className="flex items-center gap-2">
              <span className="text-lg font-semibold">
                {user?.fullName ?? user?.email}
              </span>
              {user ? (
                <Badge variant="secondary">
                  {ta(ROLE_LABEL_KEY[user.role])}
                </Badge>
              ) : null}
            </div>
            <span className="text-sm text-muted-foreground">
              {user?.email}
            </span>
          </div>
        </div>
      </Card>

      {isLoading ? (
        <div className="flex items-center gap-2 text-muted-foreground">
          <Spinner />
          {tc('loading')}
        </div>
      ) : isError ? (
        <p className="text-destructive">{tc('error')}</p>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <KpiCard
              label={t('overallProgress')}
              value={`${overallPercent}%`}
              icon={TrendingUp}
            />
            <KpiCard
              label={t('lessonsCompleted')}
              value={`${lessonsCompleted} / ${lessonsTotal}`}
              icon={BookMarked}
            />
            <KpiCard label={t('inProgress')} value={inProgress} icon={Wrench} />
            <KpiCard
              label={t('modulesCount')}
              value={modules.length}
              icon={Layers}
            />
          </div>

          <Card>
            <CardHeader>
              <CardTitle>{t('moduleProgress')}</CardTitle>
            </CardHeader>
            <CardContent>
              {modules.length === 0 ? (
                <p className="text-muted-foreground">{t('noModules')}</p>
              ) : (
                <ul className="flex flex-col gap-3">
                  {modules.map((m) => (
                    <li key={m.id} className="flex items-center gap-3">
                      <span className="w-40 shrink-0 truncate text-sm font-medium">
                        {m.code ? `${m.code} · ` : ''}
                        {m.title}
                      </span>
                      <div className="h-2 flex-1 overflow-hidden rounded-full bg-muted">
                        <div
                          className="h-full rounded-full bg-primary transition-[width]"
                          style={{ width: `${m.progressPercent}%` }}
                        />
                      </div>
                      <span className="w-10 shrink-0 text-right text-sm tabular-nums text-muted-foreground">
                        {m.progressPercent}%
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </main>
  );
}
