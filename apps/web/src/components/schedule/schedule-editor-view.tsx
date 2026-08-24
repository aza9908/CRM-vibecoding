'use client';

import { useState, type FormEvent } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { CalendarPlus, Pencil, Trash2 } from 'lucide-react';
import {
  scheduleEventTypeEnum,
  type CreateScheduleEventDto,
  type ScheduleEventDto,
  type ScheduleEventType,
} from '@lms/shared';
import {
  useCreateScheduleEvent,
  useDeleteScheduleEvent,
  useLessons,
  useSchedule,
  useUpdateScheduleEvent,
} from '@/lib/api/hooks';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Spinner } from '@/components/ui/spinner';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Modal } from '@/components/lessons/modal';
import { ProgramTimeline } from '@/components/cabinet/program-timeline';

/** Sentinel for the "no lesson linked" option — Radix Select rejects "". */
const NO_LESSON = 'none';

interface FormState {
  title: string;
  type: ScheduleEventType;
  date: string;
  startTime: string;
  endTime: string;
  description: string;
  location: string;
  meetingUrl: string;
  lessonId: string;
}

const EMPTY_FORM: FormState = {
  title: '',
  type: 'lesson',
  date: '',
  startTime: '10:00',
  endTime: '',
  description: '',
  location: '',
  meetingUrl: '',
  lessonId: NO_LESSON,
};

/**
 * `<input type="date">` + `<input type="time">` are local wall-clock values;
 * the API stores absolute instants. Going through `new Date(y, m, d, h, min)`
 * interprets them in the editor's own timezone, which is the timezone the
 * person scheduling the class is thinking in.
 */
function toInstant(date: string, time: string): string | null {
  if (!date || !time) return null;
  const [y, m, d] = date.split('-').map(Number);
  const [h, min] = time.split(':').map(Number);
  if ([y, m, d, h, min].some((n) => n === undefined || Number.isNaN(n))) {
    return null;
  }
  const local = new Date(y!, m! - 1, d!, h!, min!, 0, 0);
  return Number.isNaN(local.getTime()) ? null : local.toISOString();
}

/** Split a stored instant back into the local date + time inputs. */
function fromInstant(iso: string): { date: string; time: string } {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return {
    date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
    time: `${pad(d.getHours())}:${pad(d.getMinutes())}`,
  };
}

/**
 * Расписание программы — the authoring screen behind the timeline students see
 * in their личный кабинет. Restricted to admin / curator / methodist by the
 * API; the nav only offers it to those roles.
 */
export function ScheduleEditorView() {
  const t = useTranslations('schedule');
  const tc = useTranslations('common');
  const locale = useLocale();
  const { data, isLoading } = useSchedule();
  const { data: lessons } = useLessons();
  const create = useCreateScheduleEvent();
  const update = useUpdateScheduleEvent();
  const remove = useDeleteScheduleEvent();

  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<ScheduleEventDto | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [error, setError] = useState<string | null>(null);

  const dateFmt = new Intl.DateTimeFormat(locale, {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });

  function set<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  function openCreate() {
    setEditing(null);
    setForm(EMPTY_FORM);
    setError(null);
    setOpen(true);
  }

  function openEdit(event: ScheduleEventDto) {
    const start = fromInstant(event.startsAt);
    setEditing(event);
    setForm({
      title: event.title,
      type: event.type,
      date: start.date,
      startTime: start.time,
      endTime: event.endsAt ? fromInstant(event.endsAt).time : '',
      description: event.description ?? '',
      location: event.location ?? '',
      meetingUrl: event.meetingUrl ?? '',
      lessonId: event.lessonId ?? NO_LESSON,
    });
    setError(null);
    setOpen(true);
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);

    const startsAt = toInstant(form.date, form.startTime);
    if (!form.title.trim() || !startsAt) {
      setError(t('formInvalid'));
      return;
    }

    const dto: CreateScheduleEventDto = {
      title: form.title.trim(),
      type: form.type,
      startsAt,
      endsAt: toInstant(form.date, form.endTime),
      description: form.description.trim() || null,
      location: form.location.trim() || null,
      meetingUrl: form.meetingUrl.trim() || null,
      lessonId: form.lessonId === NO_LESSON ? null : form.lessonId,
    };

    try {
      if (editing) {
        await update.mutateAsync({ id: editing.id, dto });
      } else {
        await create.mutateAsync(dto);
      }
      setOpen(false);
    } catch {
      setError(t('saveFailed'));
    }
  }

  const pending = create.isPending || update.isPending;

  return (
    <main className="container flex flex-col gap-6 py-8">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">
            {t('editorTitle')}
          </h1>
          <p className="mt-1 text-muted-foreground">{t('editorSubtitle')}</p>
        </div>
        <Button type="button" onClick={openCreate}>
          <CalendarPlus className="h-4 w-4" />
          {t('newEvent')}
        </Button>
      </div>

      {/* Editable list */}
      {isLoading ? (
        <div className="flex items-center gap-2 text-muted-foreground">
          <Spinner />
          {tc('loading')}
        </div>
      ) : (data?.events.length ?? 0) === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-sm text-muted-foreground">
            {t('editorEmpty')}
          </CardContent>
        </Card>
      ) : (
        <Card className="divide-y">
          {data?.events.map((event) => (
            <div
              key={event.id}
              className="flex flex-wrap items-center gap-3 px-4 py-3"
            >
              <span className="w-40 shrink-0 text-sm tabular-nums text-muted-foreground">
                {dateFmt.format(new Date(event.startsAt))}
              </span>
              <Badge variant="outline" className="shrink-0">
                {t(`type_${event.type}`)}
              </Badge>
              <span className="min-w-0 flex-1 truncate font-medium">
                {event.title}
              </span>
              <div className="flex shrink-0 gap-1">
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  onClick={() => openEdit(event)}
                  aria-label={tc('edit')}
                >
                  <Pencil className="h-4 w-4" />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  disabled={remove.isPending}
                  onClick={() => {
                    if (window.confirm(t('deleteConfirm'))) {
                      remove.mutate(event.id);
                    }
                  }}
                  aria-label={tc('delete')}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            </div>
          ))}
        </Card>
      )}

      {/* Exactly what the student sees, so the author can check their work. */}
      <div>
        <h2 className="mb-3 text-lg font-semibold">{t('previewTitle')}</h2>
        <ProgramTimeline />
      </div>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={editing ? t('editEvent') : t('newEvent')}
        className="max-w-lg"
      >
        <form onSubmit={submit} className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="ev-title">{t('fieldTitle')}</Label>
            <Input
              id="ev-title"
              autoFocus
              value={form.title}
              onChange={(e) => set('title', e.target.value)}
              placeholder={t('fieldTitlePlaceholder')}
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="ev-type">{t('fieldType')}</Label>
              <Select
                value={form.type}
                onValueChange={(v) => set('type', v as ScheduleEventType)}
              >
                <SelectTrigger id="ev-type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {scheduleEventTypeEnum.options.map((option) => (
                    <SelectItem key={option} value={option}>
                      {t(`type_${option}`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="ev-date">{t('fieldDate')}</Label>
              <Input
                id="ev-date"
                type="date"
                value={form.date}
                onChange={(e) => set('date', e.target.value)}
              />
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="ev-start">{t('fieldStartTime')}</Label>
              <Input
                id="ev-start"
                type="time"
                value={form.startTime}
                onChange={(e) => set('startTime', e.target.value)}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="ev-end">{t('fieldEndTime')}</Label>
              <Input
                id="ev-end"
                type="time"
                value={form.endTime}
                onChange={(e) => set('endTime', e.target.value)}
              />
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="ev-desc">{t('fieldDescription')}</Label>
            <Textarea
              id="ev-desc"
              rows={2}
              value={form.description}
              onChange={(e) => set('description', e.target.value)}
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="ev-location">{t('fieldLocation')}</Label>
              <Input
                id="ev-location"
                value={form.location}
                placeholder={t('fieldLocationPlaceholder')}
                onChange={(e) => set('location', e.target.value)}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="ev-url">{t('fieldMeetingUrl')}</Label>
              <Input
                id="ev-url"
                type="url"
                value={form.meetingUrl}
                placeholder="https://meet.google.com/…"
                onChange={(e) => set('meetingUrl', e.target.value)}
              />
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="ev-lesson">{t('fieldLesson')}</Label>
            <Select
              value={form.lessonId}
              onValueChange={(v) => set('lessonId', v)}
            >
              <SelectTrigger id="ev-lesson">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NO_LESSON}>{t('noLesson')}</SelectItem>
                {(lessons ?? []).map((lesson) => (
                  <SelectItem key={lesson.id} value={lesson.id}>
                    {lesson.title}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}

          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
              {tc('cancel')}
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? <Spinner /> : null}
              {tc('save')}
            </Button>
          </div>
        </form>
      </Modal>
    </main>
  );
}
