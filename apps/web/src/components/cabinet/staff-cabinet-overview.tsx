'use client';

import { useTranslations } from 'next-intl';
import {
  Activity,
  BookOpenCheck,
  Building2,
  TrendingUp,
  Users,
} from 'lucide-react';
import type { UserRole } from '@lms/shared';
import { Link } from '@/i18n/routing';
import { useAuthStore } from '@/lib/store/auth-store';
import { useCompanyStats } from '@/lib/api/hooks/use-analytics';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { KpiCard } from '@/components/reports/kpi-card';

/**
 * "Обзор" for teacher/methodist/admin — org-wide KPIs and shortcuts, not the
 * student cabinet. Per TZ_LMS_roles_promocodes.md §1.1/§6.3/§14.13: staff
 * must never see the "enter a session code" banner or personal-progress
 * widgets, since neither means anything for someone who isn't a learner.
 */
export function StaffCabinetOverview() {
  const t = useTranslations('cabinet');
  const user = useAuthStore((s) => s.user);
  const { data, isLoading, isError } = useCompanyStats();

  const roleKey = user ? (`role_${user.role satisfies UserRole}` as const) : null;
  // `team_lead` gets this overview (analytics access) but not lesson
  // management — GET /lessons is `@Roles('teacher','methodist','admin')`,
  // so a team_lead clicking through would 403.
  const canManageLessons =
    user?.role === 'teacher' || user?.role === 'methodist' || user?.role === 'admin';
  // Same gating as the sidebar (`AppShell`): only an admin (org-scoped or
  // platform-wide) actually has a "Компании" screen to link to — a plain
  // teacher/methodist has no such route and would hit a 403.
  const companiesHref = user?.isPlatformAdmin
    ? '/platform/companies'
    : user?.role === 'admin'
      ? '/admin/promo-codes'
      : null;
  const initial =
    user?.fullName?.trim()?.[0]?.toUpperCase() ??
    user?.email?.[0]?.toUpperCase() ??
    '?';

  return (
    <div className="space-y-8">
      <Card>
        <CardContent className="flex flex-wrap items-center gap-4 py-6">
          <div className="flex h-14 w-14 items-center justify-center rounded-full bg-primary text-xl font-semibold text-primary-foreground">
            {initial}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="truncate text-xl font-semibold">
                {user?.fullName ?? user?.email}
              </h1>
              {roleKey ? <Badge variant="secondary">{t(roleKey)}</Badge> : null}
            </div>
            {user?.occupation ? (
              <p className="truncate text-sm text-muted-foreground">
                {user.occupation}
              </p>
            ) : null}
          </div>
        </CardContent>
      </Card>

      {isLoading && (
        <div className="flex justify-center py-16">
          <Spinner />
        </div>
      )}
      {isError && (
        <p className="py-8 text-center text-sm text-muted-foreground">
          {t('loadError')}
        </p>
      )}

      {!isLoading && !isError && data ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <KpiCard
            icon={Users}
            label={t('staffTotalStudents')}
            value={data.totalStudents}
          />
          <KpiCard
            icon={Activity}
            label={t('staffActive30d')}
            value={data.active30d}
          />
          <KpiCard
            icon={TrendingUp}
            label={t('staffAvgProgress')}
            value={`${data.avgProgress}%`}
          />
          <KpiCard
            icon={BookOpenCheck}
            label={t('staffCompletedLessons')}
            value={data.completedLessons}
          />
        </div>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>{t('staffQuickActionsTitle')}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-3">
          {canManageLessons ? (
            <Button asChild>
              <Link href="/teacher/lessons">{t('staffGoToLessons')}</Link>
            </Button>
          ) : null}
          {companiesHref ? (
            <Button asChild variant="outline">
              <Link href={companiesHref}>
                <Building2 className="h-4 w-4" />
                {t('staffGoToCompanies')}
              </Link>
            </Button>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}
