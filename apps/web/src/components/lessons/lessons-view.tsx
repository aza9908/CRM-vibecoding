'use client';

import { useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Plus } from 'lucide-react';
import { useCurriculum, useLessons, useLiveSessions } from '@/lib/api/hooks';
import type { LiveSessionSummary } from '@/lib/api/types';
import { compareLessons, useLessonDateFormatter } from '@/lib/lesson-kind';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { LessonCard } from './lesson-card';
import { CreateLessonDialog } from './create-lesson-dialog';

/**
 * Teacher lessons dashboard: list + create dialog + per-lesson actions.
 * `GET /lessons` (guarded server-side to teacher/methodist/admin, unlike
 * `/curriculum`) is the primary — and access-gating — data source, exactly
 * as before; `useCurriculum()` is fetched only as a secondary, deduped
 * lookup for each lesson's real `modules.order` (which the flat lessons
 * endpoint doesn't expose), so unscheduled lessons from different modules
 * sort the same way here as in the schedule/timeline view without loosening
 * who can even load this page.
 */
export function LessonsView() {
  const t = useTranslations('lessons');
  const tc = useTranslations('common');
  const { data: lessons, isLoading, isError, refetch } = useLessons();
  const { data: curriculum } = useCurriculum();
  const { data: liveSessions } = useLiveSessions();
  const [dialogOpen, setDialogOpen] = useState(false);
  const dateFormatter = useLessonDateFormatter();

  const liveByLesson = new Map<string, LiveSessionSummary>(
    (liveSessions ?? [])
      .filter((s) => s.lessonId)
      .map((s) => [s.lessonId as string, s]),
  );

  // Module-less lessons are bucketed by `getCurriculumTree` into a synthetic
  // module keyed `'unassigned'` (see curriculum.service.ts) sorted last via
  // `order: Number.MAX_SAFE_INTEGER` — look up by that same key (`l.moduleId
  // ?? 'unassigned'`), not by skipping the lookup on a falsy moduleId, or an
  // unscheduled module-less lesson would wrongly get `moduleOrder`'s `?? 0`
  // fallback and sort as if it were in the very first module.
  const moduleOrderById = useMemo(() => {
    const map = new Map<string, number>();
    for (const m of curriculum?.modules ?? []) map.set(m.id, m.order);
    return map;
  }, [curriculum]);

  const orderedLessons = useMemo(() => {
    if (!lessons) return lessons;
    const withModuleOrder = lessons.map((l) => ({
      ...l,
      moduleOrder: moduleOrderById.get(l.moduleId ?? 'unassigned'),
    }));
    return [...withModuleOrder].sort(compareLessons);
  }, [lessons, moduleOrderById]);

  return (
    <>
      <div className="mb-8 flex flex-wrap items-center justify-between gap-4">
        <h1 className="text-3xl font-bold tracking-tight">{t('title')}</h1>
        <Button onClick={() => setDialogOpen(true)}>
          <Plus />
          {t('newLesson')}
        </Button>
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
      ) : !orderedLessons || orderedLessons.length === 0 ? (
        <div className="flex items-center justify-center rounded-lg border border-dashed bg-card/50 p-16 text-center">
          <p className="text-muted-foreground">{t('noLessons')}</p>
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          {orderedLessons.map((lesson) => (
            <LessonCard
              key={lesson.id}
              lesson={lesson}
              activeSession={liveByLesson.get(lesson.id)}
              dateFormatter={dateFormatter}
            />
          ))}
        </div>
      )}

      <CreateLessonDialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
      />
    </>
  );
}
