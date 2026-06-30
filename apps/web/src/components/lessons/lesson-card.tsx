'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import {
  BarChart3,
  FileText,
  Pencil,
  Radio,
  Trash2,
  Video,
  type LucideIcon,
} from 'lucide-react';
import type { Lesson, LiveSessionSummary } from '@/lib/api/types';
import type { LessonType } from '@lms/shared';
import { Link, useRouter } from '@/i18n/routing';
import {
  useStartSession,
  useDeleteLesson,
} from '@/lib/api/hooks';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Spinner } from '@/components/ui/spinner';

const TYPE_META: Record<LessonType, { icon: LucideIcon; labelKey: string }> = {
  video: { icon: Video, labelKey: 'typeVideo' },
  stream: { icon: Radio, labelKey: 'typeStream' },
  text: { icon: FileText, labelKey: 'typeText' },
};

/** A single lesson row: open editor, go live (or resume a running one), delete. */
export function LessonCard({
  lesson,
  activeSession,
}: {
  lesson: Lesson;
  activeSession?: LiveSessionSummary;
}) {
  const t = useTranslations('lessons');
  const tReports = useTranslations('reports');
  const router = useRouter();
  const startSession = useStartSession();
  const deleteLesson = useDeleteLesson();
  const [error, setError] = useState<string | null>(null);

  async function goLive() {
    setError(null);
    try {
      const session = await startSession.mutateAsync({ lessonId: lesson.id });
      router.push(`/teacher/live/${session.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to start session');
    }
  }

  function onDelete() {
    if (!window.confirm(t('deleteConfirm'))) return;
    deleteLesson.mutate(lesson.id);
  }

  const { icon: TypeIcon, labelKey } = TYPE_META[lesson.type];

  return (
    <Card className="flex flex-col transition-shadow hover:shadow-md">
      <CardHeader className="flex-row items-start justify-between gap-2 space-y-0">
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="secondary" className="w-fit gap-1.5">
              <TypeIcon className="size-3.5" />
              {t(labelKey)}
            </Badge>
            {activeSession ? (
              <Badge className="w-fit gap-1.5 border-transparent bg-destructive/10 text-destructive">
                <span className="size-2 animate-pulse rounded-full bg-destructive" />
                {t('liveNow')} · {activeSession.code}
              </Badge>
            ) : null}
          </div>
          <CardTitle>{lesson.title}</CardTitle>
        </div>
        <Button
          variant="ghost"
          size="icon"
          className="-mr-2 -mt-1 shrink-0 text-muted-foreground hover:text-destructive"
          onClick={onDelete}
          disabled={deleteLesson.isPending}
          aria-label={t('deleteConfirm')}
        >
          <Trash2 />
        </Button>
      </CardHeader>
      <CardContent className="mt-auto flex flex-col gap-3">
        <div className="grid grid-cols-2 gap-2">
          <Button asChild variant="outline">
            <Link href={`/editor/${lesson.id}`}>
              <Pencil />
              {t('openEditor')}
            </Link>
          </Button>
          {activeSession ? (
            <Button asChild>
              <Link href={`/teacher/live/${activeSession.id}`}>
                <Radio />
                {t('resumeLive')}
              </Link>
            </Button>
          ) : (
            <Button onClick={goLive} disabled={startSession.isPending}>
              {startSession.isPending ? <Spinner /> : <Radio />}
              {t('startLive')}
            </Button>
          )}
        </div>
        <Button asChild variant="ghost" size="sm" className="w-full">
          <Link href={`/teacher/lessons/${lesson.id}/reports`}>
            <BarChart3 />
            {tReports('title')}
          </Link>
        </Button>
        {error ? (
          <p className="text-sm text-destructive" role="alert">
            {error}
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}
