'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import {
  Archive,
  ArchiveRestore,
  BarChart3,
  CalendarClock,
  Check,
  FileText,
  Pencil,
  Radio,
  Trash2,
  Video,
  X,
  type LucideIcon,
} from 'lucide-react';
import type { Lesson, LiveSessionSummary } from '@/lib/api/types';
import type { LessonType } from '@lms/shared';
import { Link, useRouter } from '@/i18n/routing';
import {
  useStartSession,
  useDeleteLesson,
  useUpdateLesson,
} from '@/lib/api/hooks';
import { KIND_BADGE_VARIANT, KIND_LABEL_KEY, formatLessonDate } from '@/lib/lesson-kind';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Spinner } from '@/components/ui/spinner';

const TYPE_META: Record<LessonType, { icon: LucideIcon; labelKey: string }> = {
  video: { icon: Video, labelKey: 'typeVideo' },
  stream: { icon: Radio, labelKey: 'typeStream' },
  text: { icon: FileText, labelKey: 'typeText' },
};

/** A single lesson row: rename, open editor, go live, delete. */
export function LessonCard({
  lesson,
  activeSession,
  dateFormatter,
}: {
  lesson: Lesson;
  activeSession?: LiveSessionSummary;
  /** Shared across the whole list — built once by the parent, not per card. */
  dateFormatter: Intl.DateTimeFormat;
}) {
  const t = useTranslations('lessons');
  const tCommon = useTranslations('common');
  const tReports = useTranslations('reports');
  const tSchedule = useTranslations('schedule');
  const router = useRouter();
  const startSession = useStartSession();
  const deleteLesson = useDeleteLesson();
  const updateLesson = useUpdateLesson(lesson.id);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [titleDraft, setTitleDraft] = useState(lesson.title);

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

  function toggleArchived() {
    // Archiving hides the card (and its "Resume Live" link) from the
    // default list, which would otherwise strand a teacher mid-class with
    // no obvious way back to an active session — confirm only for that case.
    if (!lesson.archived && activeSession) {
      if (!window.confirm(t('archiveLiveConfirm'))) return;
    }
    updateLesson.mutate({ archived: !lesson.archived });
  }

  async function saveTitle() {
    const next = titleDraft.trim();
    if (!next || next === lesson.title) {
      setEditing(false);
      setTitleDraft(lesson.title);
      return;
    }
    setError(null);
    try {
      await updateLesson.mutateAsync({ title: next });
      setEditing(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('renameFailed'));
    }
  }

  const { icon: TypeIcon, labelKey } = TYPE_META[lesson.type];
  const scheduledLabel = formatLessonDate(lesson.scheduledAt, dateFormatter);

  return (
    <Card
      className={`flex flex-col transition-shadow hover:shadow-md${lesson.archived ? ' opacity-60' : ''}`}
    >
      <CardHeader className="flex-row items-start justify-between gap-2 space-y-0">
        <div className="flex min-w-0 flex-1 flex-col gap-3">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <CalendarClock className="size-3.5 shrink-0 text-muted-foreground" />
            {scheduledLabel ? (
              <span className="font-medium">{scheduledLabel}</span>
            ) : (
              <span className="text-muted-foreground">{tSchedule('dateTbd')}</span>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="secondary" className="w-fit gap-1.5">
              <TypeIcon className="size-3.5" />
              {t(labelKey)}
            </Badge>
            {lesson.kind ? (
              <Badge variant={KIND_BADGE_VARIANT[lesson.kind]} className="w-fit">
                {t(KIND_LABEL_KEY[lesson.kind])}
              </Badge>
            ) : null}
            {activeSession ? (
              <Badge className="w-fit gap-1.5 border-transparent bg-destructive/10 text-destructive">
                <span className="size-2 animate-pulse rounded-full bg-destructive" />
                {t('liveNow')} · {activeSession.code}
              </Badge>
            ) : null}
            {lesson.archived ? (
              <Badge variant="outline" className="w-fit gap-1.5">
                <Archive className="size-3.5" />
                {t('archived')}
              </Badge>
            ) : null}
          </div>
          {editing ? (
            <div className="flex items-center gap-1.5">
              <Input
                value={titleDraft}
                onChange={(e) => setTitleDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void saveTitle();
                  if (e.key === 'Escape') {
                    setEditing(false);
                    setTitleDraft(lesson.title);
                  }
                }}
                aria-label={t('lessonTitle')}
                autoFocus
                className="h-9"
              />
              <Button
                type="button"
                size="icon"
                variant="ghost"
                onClick={() => void saveTitle()}
                disabled={updateLesson.isPending}
                aria-label={tCommon('save')}
              >
                {updateLesson.isPending ? <Spinner /> : <Check />}
              </Button>
              <Button
                type="button"
                size="icon"
                variant="ghost"
                onClick={() => {
                  setEditing(false);
                  setTitleDraft(lesson.title);
                }}
                aria-label={tCommon('cancel')}
              >
                <X />
              </Button>
            </div>
          ) : (
            <div className="flex items-start gap-1">
              <CardTitle className="min-w-0 flex-1 break-words">
                {lesson.title}
              </CardTitle>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="shrink-0 text-muted-foreground"
                onClick={() => {
                  setTitleDraft(lesson.title);
                  setEditing(true);
                }}
                aria-label={t('rename')}
              >
                <Pencil className="size-4" />
              </Button>
            </div>
          )}
        </div>
        <div className="-mr-2 -mt-1 flex shrink-0 items-center gap-0.5">
          <Button
            variant="ghost"
            size="icon"
            className="text-muted-foreground"
            onClick={toggleArchived}
            disabled={updateLesson.isPending}
            aria-label={lesson.archived ? t('unarchive') : t('archive')}
            title={lesson.archived ? t('unarchive') : t('archive')}
          >
            {lesson.archived ? <ArchiveRestore /> : <Archive />}
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="text-muted-foreground hover:text-destructive"
            onClick={onDelete}
            disabled={deleteLesson.isPending}
            aria-label={t('deleteConfirm')}
          >
            <Trash2 />
          </Button>
        </div>
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
