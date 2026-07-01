'use client';

import { useMemo } from 'react';
import { useTranslations } from 'next-intl';
import {
  BookOpenCheck,
  CircleDot,
  GraduationCap,
  LibraryBig,
  LogIn,
  TrendingUp,
} from 'lucide-react';
import type { CurriculumLesson, UserRole } from '@lms/shared';
import { Link } from '@/i18n/routing';
import { useAuthStore } from '@/lib/store/auth-store';
import { useCurriculum } from '@/lib/api/hooks';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';

/** Thin horizontal progress bar (0–100). */
function ProgressBar({ value }: { value: number }) {
  const clamped = Math.max(0, Math.min(100, Math.round(value)));
  return (
    <div
      className="h-2 w-full overflow-hidden rounded-full bg-muted"
      role="progressbar"
      aria-valuenow={clamped}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <div
        className="h-full rounded-full bg-primary transition-all"
        style={{ width: `${clamped}%` }}
      />
    </div>
  );
}

function StatCard({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
}) {
  return (
    <Card>
      <CardContent className="flex items-center gap-4 py-5">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
          {icon}
        </div>
        <div className="min-w-0">
          <div className="truncate text-2xl font-semibold tabular-nums">
            {value}
          </div>
          <div className="truncate text-sm text-muted-foreground">{label}</div>
        </div>
      </CardContent>
    </Card>
  );
}

/**
 * Личный кабинет — the student's personal room (docs: personal monitoring).
 *
 * Reads the curriculum tree (which carries per-lesson progress for students)
 * and renders: profile summary, headline stats, per-module progress, and a
 * "continue learning" list of lessons that are started but unfinished.
 */
export function CabinetView() {
  const t = useTranslations('cabinet');
  const user = useAuthStore((s) => s.user);
  const { data, isLoading, isError } = useCurriculum();

  const stats = useMemo(() => {
    const modules = data?.modules ?? [];
    const lessons = modules.flatMap((m) => m.lessons);
    const completed = lessons.filter(
      (l) => l.progressStatus === 'completed' || l.progressPercent === 100,
    );
    const inProgress = lessons.filter(
      (l) =>
        l.progressStatus !== 'completed' &&
        (l.progressPercent ?? 0) > 0 &&
        (l.progressPercent ?? 0) < 100,
    );
    const overall =
      lessons.length === 0
        ? 0
        : lessons.reduce((sum, l) => sum + (l.progressPercent ?? 0), 0) /
          lessons.length;
    return { modules, lessons, completed, inProgress, overall };
  }, [data]);

  if (!user) {
    return (
      <div className="mx-auto flex max-w-md flex-col items-center gap-4 py-24 text-center">
        <GraduationCap className="h-10 w-10 text-muted-foreground" />
        <p className="text-muted-foreground">{t('signInPrompt')}</p>
        <Button asChild>
          <Link href="/login">
            <LogIn className="mr-2 h-4 w-4" />
            {t('signIn')}
          </Link>
        </Button>
      </div>
    );
  }

  const roleKey = `role_${user.role satisfies UserRole}` as const;
  const initial =
    user.fullName?.trim()?.[0]?.toUpperCase() ??
    user.email[0]?.toUpperCase() ??
    '?';

  return (
    <div className="space-y-8">
      {/* Profile */}
      <Card>
        <CardContent className="flex flex-wrap items-center gap-4 py-6">
          <div className="flex h-14 w-14 items-center justify-center rounded-full bg-primary text-xl font-semibold text-primary-foreground">
            {initial}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="truncate text-xl font-semibold">
                {user.fullName ?? user.email}
              </h1>
              <Badge variant="secondary">{t(roleKey)}</Badge>
            </div>
            <p className="truncate text-sm text-muted-foreground">
              {user.email}
            </p>
          </div>
          {data?.course && (
            <div className="text-right">
              <div className="text-sm text-muted-foreground">
                {t('currentCourse')}
              </div>
              <div className="max-w-[16rem] truncate font-medium">
                {data.course.title}
              </div>
            </div>
          )}
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

      {!isLoading && !isError && (
        <>
          {/* Headline stats */}
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard
              icon={<TrendingUp className="h-5 w-5" />}
              label={t('overallProgress')}
              value={`${Math.round(stats.overall)}%`}
            />
            <StatCard
              icon={<BookOpenCheck className="h-5 w-5" />}
              label={t('lessonsCompleted')}
              value={`${stats.completed.length} / ${stats.lessons.length}`}
            />
            <StatCard
              icon={<CircleDot className="h-5 w-5" />}
              label={t('lessonsInProgress')}
              value={String(stats.inProgress.length)}
            />
            <StatCard
              icon={<LibraryBig className="h-5 w-5" />}
              label={t('modules')}
              value={String(stats.modules.length)}
            />
          </div>

          {/* Continue learning */}
          {stats.inProgress.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>{t('continueLearning')}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {[...stats.inProgress]
                  .sort(
                    (a: CurriculumLesson, b: CurriculumLesson) =>
                      (b.progressPercent ?? 0) - (a.progressPercent ?? 0),
                  )
                  .slice(0, 5)
                  .map((lesson) => (
                    <div
                      key={lesson.id}
                      className="flex items-center gap-4"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-medium">
                          {lesson.title}
                        </div>
                        <ProgressBar value={lesson.progressPercent ?? 0} />
                      </div>
                      <span className="w-10 shrink-0 text-right text-sm tabular-nums text-muted-foreground">
                        {Math.round(lesson.progressPercent ?? 0)}%
                      </span>
                    </div>
                  ))}
                <Button asChild variant="outline" size="sm">
                  <Link href="/syllabus">{t('openSyllabus')}</Link>
                </Button>
              </CardContent>
            </Card>
          )}

          {/* Per-module progress */}
          <Card>
            <CardHeader>
              <CardTitle>{t('moduleProgress')}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-5">
              {stats.modules.length === 0 && (
                <p className="text-sm text-muted-foreground">
                  {t('noModules')}
                </p>
              )}
              {stats.modules.map((m) => (
                <div key={m.id} className="space-y-1.5">
                  <div className="flex items-baseline justify-between gap-4">
                    <div className="min-w-0 truncate text-sm font-medium">
                      {m.code ? `${m.code} · ` : ''}
                      {m.title}
                    </div>
                    <span className="shrink-0 text-sm tabular-nums text-muted-foreground">
                      {Math.round(m.progressPercent)}%
                    </span>
                  </div>
                  <ProgressBar value={m.progressPercent} />
                </div>
              ))}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
