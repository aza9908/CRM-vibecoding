'use client';

import { useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { CalendarClock, Pencil, X } from 'lucide-react';
import type { CurriculumLesson } from '@lms/shared';
import { useCurriculum, useUpdateLesson } from '@/lib/api/hooks';
import { useAuthStore } from '@/lib/store/auth-store';
import {
  KIND_BADGE_VARIANT,
  KIND_LABEL_KEY,
  compareLessons,
  formatLessonDate,
  useLessonDateFormatter,
} from '@/lib/lesson-kind';
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
 * sessions and Demo day. Урок 0 (onboarding) always leads; after that,
 * lessons are in true chronological order by the date/time the teacher
 * scheduled them, across every module, not grouped by module first —
 * unscheduled lessons sort last, by curriculum order (`compareLessons`,
 * shared with the teacher's own lesson dashboard so the two views can't
 * drift into disagreeing on order). Reuses `useCurriculum()` (already
 * fetched by the cabinet / syllabus / lessons views, so TanStack Query
 * dedupes the request). Teachers/admins get an inline date/time editor on
 * each row; students see a read-only formatted date.
 */
export function CurriculumTimeline() {
  const t = useTranslations('lessons');
  const ts = useTranslations('schedule');
  const tc = useTranslations('common');
  const user = useAuthStore((s) => s.user);
  const canManage =
    user?.role === 'teacher' || user?.role === 'methodist' || user?.role === 'admin';
  const { data, isLoading, isError } = useCurriculum();
  const dateFormatter = useLessonDateFormatter();

  // A single global sort, not "sort within each module then concatenate
  // by module order" — this is the real class schedule, so two *scheduled*
  // lessons must compare by true date regardless of which module either is
  // in (see `compareLessons`'s doc comment). `moduleOrder` only matters as
  // a tiebreak between two lessons that are both still unscheduled, and the
  // curriculum tree gives us the module's real `order` for that.
  const lessons = useMemo(() => {
    const withModuleOrder = (data?.modules ?? []).flatMap((m) =>
      m.lessons.map((l) => ({ ...l, moduleOrder: m.order })),
    );
    return withModuleOrder.sort(compareLessons);
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
      {lessons.map((lesson: CurriculumLesson) => {
        const scheduledLabel = formatLessonDate(lesson.scheduledAt, dateFormatter);
        return (
        <Card key={lesson.id}>
          <CardContent className="flex flex-col gap-2 py-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2 text-sm">
                <CalendarClock className="h-4 w-4 shrink-0 text-muted-foreground" />
                {scheduledLabel ? (
                  <span className="font-medium">{scheduledLabel}</span>
                ) : lesson.sessionStatus === 'ended' ? (
                  // No teacher-set schedule date, but a live session for this
                  // lesson already ran and ended — "Date TBD" would read as
                  // "not scheduled yet" for something that already happened.
                  <span className="text-muted-foreground">{ts('lessonPast')}</span>
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

            {lesson.sessionStatus === 'ended' ? (
              // Once the cohort's session has ended, that's the fact that
              // matters here — not this one student's own workbook
              // progress, which is what "Прошлые уроки" also keys off of.
              // Showing per-student progressStatus instead ("Начато") for
              // an already-ended lesson contradicted that other view. Only
              // repeated here when the date line above showed a real date
              // instead of this same "lessonPast" text, to avoid saying it
              // twice on one card.
              scheduledLabel ? (
                <p className="text-sm text-muted-foreground">{ts('lessonPast')}</p>
              ) : null
            ) : lesson.progressStatus ? (
              <p className="text-sm text-muted-foreground">
                {lesson.progressStatus === 'completed'
                  ? ts('progressCompleted')
                  : ts('progressStarted')}
              </p>
            ) : null}

            {canManage ? <ScheduleEditor lesson={lesson} /> : null}
          </CardContent>
        </Card>
        );
      })}
    </div>
  );
}
