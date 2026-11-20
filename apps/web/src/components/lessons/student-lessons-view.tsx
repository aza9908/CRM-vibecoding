'use client';

import { useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { BookOpen, FolderOpen, KeyRound, PlayCircle } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Link } from '@/i18n/routing';
import { useCurriculum } from '@/lib/api/hooks';
import { KIND_BADGE_VARIANT, KIND_LABEL_KEY } from '@/lib/lesson-kind';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Spinner } from '@/components/ui/spinner';

/**
 * Student-safe lesson list from curriculum (no teacher CRUD).
 *
 * `variant="past"` (used by the "Прошлые уроки" nav page) filters down to
 * lessons whose most recent live session has already ended — a cohort-wide
 * split, not this student's own progress — same data source
 * (`useCurriculum()`), no new endpoint, just a different slice of the same
 * list.
 */
export function StudentLessonsView({
  variant = 'upcoming',
}: {
  variant?: 'upcoming' | 'past';
}) {
  const t = useTranslations('lessons');
  const tj = useTranslations('join');
  const tc = useTranslations('common');
  const { data, isLoading, isError, refetch } = useCurriculum();

  const lessons = (
    data?.modules.flatMap((m) =>
      m.lessons.map((l) => ({ ...l, moduleTitle: m.title })),
    ) ?? []
  ).filter((l) =>
    // Cohort-wide split, not per-student: a lesson whose most recent live
    // session already ended is "past" for everyone, regardless of whether
    // this particular student finished their own workbook responses.
    variant === 'past'
      ? l.sessionStatus === 'ended'
      : l.sessionStatus !== 'ended',
  );

  // Company tiles: nothing below them until one is pressed (with a single
  // company its lessons are shown right away).
  const NONE = '__none__';
  const groups = useMemo(() => {
    const map = new Map<string, typeof lessons>();
    for (const l of lessons) {
      const key = l.category ?? NONE;
      const list = map.get(key);
      if (list) list.push(l);
      else map.set(key, [l]);
    }
    return [...map.entries()]
      .map(([key, list]) => ({ key, label: key === NONE ? t('categoryNone') : key, lessons: list }))
      .sort((a, b) => (a.key === NONE ? 1 : b.key === NONE ? -1 : a.label.localeCompare(b.label)));
  }, [lessons, t]);
  const [picked, setPicked] = useState<string | null>(null);
  const single = groups.length === 1;
  const current = single ? groups[0] : groups.find((g) => g.key === picked) ?? null;
  const shown = current ? current.lessons : [];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            {variant === 'past' ? t('pastTitle') : t('title')}
          </h1>
          <p className="text-sm text-muted-foreground">{t('studentHint')}</p>
        </div>
        {/* Only on the upcoming tab — a past lesson's session already ended,
            so there's nothing here a join code could ever unlock. */}
        {variant === 'past' ? null : (
          <Button asChild>
            <Link href="/join">
              <KeyRound className="h-4 w-4" />
              {tj('joinButton')}
            </Link>
          </Button>
        )}
      </div>

      {isLoading && (
        <div className="flex justify-center py-16">
          <Spinner />
        </div>
      )}

      {isError && (
        <Card className="p-6">
          <p className="mb-3 text-sm text-destructive">{tc('error')}</p>
          <Button type="button" variant="outline" onClick={() => void refetch()}>
            {tc('retry')}
          </Button>
        </Card>
      )}

      {!isLoading && !isError && lessons.length === 0 && (
        <Card className="p-8 text-center">
          <BookOpen className="mx-auto mb-3 h-8 w-8 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">
            {variant === 'past' ? t('emptyPast') : t('emptyStudent')}
          </p>
          {variant === 'past' ? null : (
            <Button asChild className="mt-4">
              <Link href="/join">{tj('title')}</Link>
            </Button>
          )}
        </Card>
      )}

      {!isLoading && !isError && lessons.length > 0 && !single && (
        <div role="tablist" aria-label={t('category')} className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {groups.map((g) => {
            const active = current?.key === g.key;
            return (
              <button
                key={g.key}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => setPicked((cur) => (cur === g.key ? null : g.key))}
                className={cn(
                  'flex min-h-[5.5rem] flex-col items-start justify-between gap-2 rounded-xl border-2 p-4 text-left shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
                  active
                    ? 'border-primary bg-primary text-primary-foreground'
                    : 'border-border bg-card text-foreground hover:border-primary/60 hover:bg-primary/5',
                )}
              >
                <span className="flex w-full items-center gap-2">
                  <FolderOpen className={cn('h-5 w-5 shrink-0', active ? 'text-primary-foreground' : 'text-primary')} aria-hidden />
                  <span className="truncate text-base font-semibold">{g.label}</span>
                </span>
                <span className={cn('text-sm tabular-nums', active ? 'text-primary-foreground/85' : 'text-muted-foreground')}>
                  {t('lessonsCount', { count: g.lessons.length })}
                </span>
              </button>
            );
          })}
        </div>
      )}

      {!isLoading && !isError && lessons.length > 0 && !current && (
        <p className="rounded-xl border border-dashed px-4 py-10 text-center text-sm text-muted-foreground">
          {t('pickCompany')}
        </p>
      )}

      {!isLoading && !isError && shown.length > 0 && (
        <div className="grid gap-3">
          {!single && current ? <h2 className="text-xl font-semibold">{current.label}</h2> : null}
          {shown.map((lesson) => (
            <Card key={lesson.id}>
              <CardHeader className="flex flex-row items-start justify-between gap-3 space-y-0 pb-2">
                <div className="min-w-0">
                  <CardTitle className="text-base">{lesson.title}</CardTitle>
                  <p className="text-sm text-muted-foreground">
                    {lesson.moduleTitle}
                  </p>
                </div>
                <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
                  {lesson.kind ? (
                    <Badge variant={KIND_BADGE_VARIANT[lesson.kind]}>
                      {t(KIND_LABEL_KEY[lesson.kind])}
                    </Badge>
                  ) : null}
                  <Badge variant="secondary">
                    {Math.round(lesson.progressPercent ?? 0)}%
                  </Badge>
                </div>
              </CardHeader>
              {/* No per-card join code here — a code is only ever needed to
                  enter a live class happening right now (the top "Войти по
                  коду" button above covers that, once per visit). A past
                  lesson opens straight into its actual content (the same
                  read-only workbook view the teacher's own preview uses),
                  not the live session — no code, and no celebration screen
                  standing in for the real material. */}
              {lesson.sessionStatus === 'ended' ? (
                <CardContent>
                  <Button asChild size="sm" variant="outline">
                    <Link href={`/editor/${lesson.id}/preview?from=past`}>
                      <PlayCircle className="h-4 w-4" />
                      {t('openLesson')}
                    </Link>
                  </Button>
                </CardContent>
              ) : lesson.sessionStatus === 'live' ? (
                <CardContent>
                  <Button asChild size="sm">
                    <Link href="/join">
                      <KeyRound className="h-4 w-4" />
                      {tj('joinNowButton')}
                    </Link>
                  </Button>
                </CardContent>
              ) : null}
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
