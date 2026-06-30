'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Plus } from 'lucide-react';
import { useLessons, useLiveSessions } from '@/lib/api/hooks';
import type { LiveSessionSummary } from '@/lib/api/types';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { LessonCard } from './lesson-card';
import { CreateLessonDialog } from './create-lesson-dialog';

/** Teacher lessons dashboard: list + create dialog + per-lesson actions. */
export function LessonsView() {
  const t = useTranslations('lessons');
  const tc = useTranslations('common');
  const { data: lessons, isLoading, isError, refetch } = useLessons();
  const { data: liveSessions } = useLiveSessions();
  const [dialogOpen, setDialogOpen] = useState(false);

  const liveByLesson = new Map<string, LiveSessionSummary>(
    (liveSessions ?? [])
      .filter((s) => s.lessonId)
      .map((s) => [s.lessonId as string, s]),
  );

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
      ) : !lessons || lessons.length === 0 ? (
        <div className="flex items-center justify-center rounded-lg border border-dashed bg-card/50 p-16 text-center">
          <p className="text-muted-foreground">{t('noLessons')}</p>
        </div>
      ) : (
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {lessons.map((lesson) => (
            <LessonCard
              key={lesson.id}
              lesson={lesson}
              activeSession={liveByLesson.get(lesson.id)}
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
