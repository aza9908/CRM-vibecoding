'use client';

import { useMemo, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { CalendarClock, Pencil, X } from 'lucide-react';
import type { CurriculumLesson } from '@lms/shared';
import { useCurriculum, useUpdateLesson } from '@/lib/api/hooks';
import { useAuthStore } from '@/lib/store/auth-store';
import { KIND_BADGE_VARIANT, KIND_LABEL_KEY } from '@/lib/lesson-kind';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Spinner } from '@/components/ui/spinner';

/** `datetime-local` inputs read/write "YYYY-MM-DDTHH:mm" in the browser's
 * local time zone (no offset) — convert to/from the ISO string the API uses. */
function isoToLocalInputValue(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Inline date/time editor shown to teachers/admins on each lesson row. */
function ScheduleEditor({ lesson }: { lesson: CurriculumLesson }) {
  const t = useTranslations('schedule');
  const update = useUpdateLesson(lesson.id);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(() => isoToLocalInputValue(lesson.scheduledAt));

  if (!editing) {
    return (
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="h-7 gap-1.5 text-xs text-muted-foreground hover:text-foreground"
        onClick={() => {
          setDraft(isoToLocalInputValue(lesson.scheduledAt));
          setEditing(true);
        }}
      >
        <Pencil className="h-3 w-3" />
        {lesson.scheduledAt ? t('editDate') : t('setDate')}
      </Button>
    );
  }

  async function save() {
    await update.mutateAsync({
      scheduledAt: draft ? new Date(draft).toISOString() : null,
    });
    setEditing(false);
  }

  async function clear() {
    setDraft('');
    await update.mutateAsync({ scheduledAt: null });
    setEditing(false);
  }

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <Input
        type="datetime-local"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        className="h-8 w-auto text-xs"
      />
      <Button type="button" size="sm" className="h-8" onClick={save} disabled={update.isPending}>
        {update.isPending ? <Spinner /> : null}
        {t('save')}
      </Button>
      {lesson.scheduledAt ? (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-8 w-8 text-muted-foreground hover:text-destructive"
          aria-label={t('clearDate')}
          onClick={clear}
          disabled={update.isPending}
        >
          <X className="h-4 w-4" />
        </Button>
      ) : null}
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="h-8"
        onClick={() => setEditing(false)}
      >
        {t('cancel')}
      </Button>
    </div>
  );
}

/**
 * Per-company class schedule — every lesson from first to last, including QA
 * sessions and Demo day, sorted by the date/time the teacher scheduled it
 * (unscheduled lessons sort last, by curriculum order). Reuses `useCurriculum()`
 * (already fetched by the cabinet / syllabus / lessons views, so TanStack
 * Query dedupes the request). Teachers/admins get an inline date/time editor
 * on each row; students see a read-only formatted date.
 */
export function CurriculumTimeline() {
  const t = useTranslations('lessons');
  const ts = useTranslations('schedule');
  const tc = useTranslations('common');
  const locale = useLocale();
  const user = useAuthStore((s) => s.user);
  const canManage =
    user?.role === 'teacher' || user?.role === 'methodist' || user?.role === 'admin';
  const { data, isLoading, isError } = useCurriculum();

  const dateFormatter = useMemo(
    () =>
      new Intl.DateTimeFormat(locale, {
        day: 'numeric',
        month: 'long',
        hour: '2-digit',
        minute: '2-digit',
      }),
    [locale],
  );

  const lessons = useMemo(() => {
    const all = (data?.modules ?? []).flatMap((m) => m.lessons);
    return [...all].sort((a, b) => {
      if (a.scheduledAt && b.scheduledAt) {
        return new Date(a.scheduledAt).getTime() - new Date(b.scheduledAt).getTime();
      }
      if (a.scheduledAt) return -1;
      if (b.scheduledAt) return 1;
      return a.order - b.order;
    });
  }, [data]);

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 py-8 text-muted-foreground">
        <Spinner />
        {tc('loading')}
      </div>
    );
  }
  if (isError) {
    return <p className="py-8 text-destructive">{tc('error')}</p>;
  }
  if (lessons.length === 0) {
    return <p className="py-8 text-muted-foreground">{tc('empty')}</p>;
  }

  return (
    <div className="flex flex-col gap-3">
      {lessons.map((lesson: CurriculumLesson) => (
        <Card key={lesson.id}>
          <CardContent className="flex flex-col gap-2 py-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2 text-sm">
                <CalendarClock className="h-4 w-4 shrink-0 text-muted-foreground" />
                {lesson.scheduledAt ? (
                  <span className="font-medium">
                    {dateFormatter.format(new Date(lesson.scheduledAt))}
                  </span>
                ) : (
                  <span className="text-muted-foreground">{ts('dateTbd')}</span>
                )}
              </div>
              {lesson.kind ? (
                <Badge variant={KIND_BADGE_VARIANT[lesson.kind]}>
                  {t(KIND_LABEL_KEY[lesson.kind])}
                </Badge>
              ) : null}
            </div>

            <p className="font-semibold tracking-tight">{lesson.title}</p>

            {lesson.progressStatus ? (
              <p className="text-sm text-muted-foreground">
                {lesson.progressStatus === 'completed'
                  ? ts('progressCompleted')
                  : ts('progressStarted')}
              </p>
            ) : null}

            {canManage ? <ScheduleEditor lesson={lesson} /> : null}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
