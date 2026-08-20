'use client';

import { useMemo } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import {
  CalendarClock,
  CalendarDays,
  CheckCircle2,
  ExternalLink,
  GraduationCap,
  MapPin,
  MessageCircleQuestion,
  Presentation,
  Sparkles,
  Video,
} from 'lucide-react';
import type { ScheduleEventDto, ScheduleEventType } from '@lms/shared';
import { Link } from '@/i18n/routing';
import { useSchedule } from '@/lib/api/hooks';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { cn } from '@/lib/utils';

/** Icon + accent colour per event kind, so the rail reads at a glance. */
const EVENT_STYLE: Record<
  ScheduleEventType,
  { icon: typeof GraduationCap; dot: string; badge: string }
> = {
  lesson: {
    icon: GraduationCap,
    dot: 'bg-primary text-primary-foreground',
    badge: 'border-primary/30 bg-primary/10 text-primary',
  },
  qa: {
    icon: MessageCircleQuestion,
    dot: 'bg-sky-500 text-white',
    badge: 'border-sky-500/30 bg-sky-500/10 text-sky-600 dark:text-sky-400',
  },
  demo_day: {
    icon: Presentation,
    dot: 'bg-amber-500 text-white',
    badge: 'border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-400',
  },
  workshop: {
    icon: Sparkles,
    dot: 'bg-violet-500 text-white',
    badge:
      'border-violet-500/30 bg-violet-500/10 text-violet-600 dark:text-violet-400',
  },
  other: {
    icon: CalendarDays,
    dot: 'bg-muted-foreground text-background',
    badge: 'border-border bg-muted text-muted-foreground',
  },
};

/** Headline figure above the rail. */
function Metric({ value, label }: { value: string; label: string }) {
  return (
    <div className="min-w-0">
      <div className="truncate text-lg font-semibold tabular-nums">{value}</div>
      <div className="truncate text-xs text-muted-foreground">{label}</div>
    </div>
  );
}

/**
 * Расписание программы обучения — the company's whole study plan on a single
 * vertical timeline, from the first lesson through every Q&A to Demo day.
 *
 * The schedule is authored by an admin (later a curator or methodist) and is
 * the same for everyone in the company, so this is a read-only view: it exists
 * to answer "what is next, and when does the program end?" without the student
 * having to ask anyone.
 */
export function ProgramTimeline({ enabled = true }: { enabled?: boolean }) {
  const t = useTranslations('schedule');
  const locale = useLocale();
  const { data, isLoading, isError } = useSchedule(enabled);

  const fmt = useMemo(
    () => ({
      day: new Intl.DateTimeFormat(locale, { day: 'numeric' }),
      month: new Intl.DateTimeFormat(locale, { month: 'short' }),
      weekday: new Intl.DateTimeFormat(locale, { weekday: 'short' }),
      time: new Intl.DateTimeFormat(locale, {
        hour: '2-digit',
        minute: '2-digit',
      }),
      span: new Intl.DateTimeFormat(locale, {
        day: 'numeric',
        month: 'long',
        year: 'numeric',
      }),
    }),
    [locale],
  );

  function timeRange(event: ScheduleEventDto): string {
    const start = fmt.time.format(new Date(event.startsAt));
    if (!event.endsAt) return start;
    return `${start} – ${fmt.time.format(new Date(event.endsAt))}`;
  }

  if (isLoading) {
    return (
      <Card>
        <CardContent className="flex justify-center py-16">
          <Spinner />
        </CardContent>
      </Card>
    );
  }

  if (isError) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-sm text-muted-foreground">
          {t('loadError')}
        </CardContent>
      </Card>
    );
  }

  const events = data?.events ?? [];

  if (events.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <CalendarClock className="h-5 w-5" />
            {t('title')}
          </CardTitle>
        </CardHeader>
        <CardContent className="pb-8 text-center">
          <CalendarDays className="mx-auto mb-3 h-10 w-10 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">{t('empty')}</p>
        </CardContent>
      </Card>
    );
  }

  const spanStart = data?.startsAt ? fmt.span.format(new Date(data.startsAt)) : null;
  const spanEnd = data?.endsAt ? fmt.span.format(new Date(data.endsAt)) : null;

  return (
    <Card>
      <CardHeader className="gap-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <CardTitle className="flex items-center gap-2">
              <CalendarClock className="h-5 w-5 shrink-0" />
              {t('title')}
            </CardTitle>
            <p className="mt-1 truncate text-sm text-muted-foreground">
              {[data?.courseTitle, data?.companyName]
                .filter(Boolean)
                .join(' · ')}
            </p>
          </div>
          {spanStart && spanEnd && (
            <Badge variant="secondary" className="shrink-0">
              {spanStart} — {spanEnd}
            </Badge>
          )}
        </div>

        <div className="grid grid-cols-2 gap-4 border-t pt-4 sm:grid-cols-4">
          <Metric
            value={`${data?.counts.past ?? 0} / ${data?.counts.total ?? 0}`}
            label={t('metricHeld')}
          />
          <Metric
            value={String(data?.counts.lessons ?? 0)}
            label={t('metricLessons')}
          />
          <Metric value={String(data?.counts.qa ?? 0)} label={t('metricQa')} />
          <Metric
            value={String(data?.counts.demoDay ?? 0)}
            label={t('metricDemoDay')}
          />
        </div>
      </CardHeader>

      <CardContent>
        <ol className="relative space-y-1">
          {/* The rail itself. Inset to line up with the centre of each marker. */}
          <span
            aria-hidden
            className="absolute left-[1.4375rem] top-3 bottom-3 w-px bg-border"
          />

          {events.map((event) => {
            const style = EVENT_STYLE[event.type];
            const Icon = event.state === 'past' ? CheckCircle2 : style.icon;
            const isNext = event.id === data?.nextEventId;
            const date = new Date(event.startsAt);

            return (
              <li key={event.id} className="relative flex gap-4 py-3">
                <span
                  aria-hidden
                  className={cn(
                    'relative z-10 flex h-12 w-12 shrink-0 items-center justify-center rounded-full ring-4 ring-card transition-colors',
                    event.state === 'past'
                      ? 'bg-muted text-muted-foreground'
                      : style.dot,
                    event.state === 'today' && 'ring-primary/30',
                  )}
                >
                  <Icon className="h-5 w-5" />
                </span>

                <div
                  className={cn(
                    'min-w-0 flex-1 rounded-lg border p-4 transition-colors',
                    event.state === 'past' && 'border-dashed opacity-70',
                    event.state === 'today' && 'border-primary bg-primary/5',
                    isNext && event.state !== 'today' && 'border-primary/50',
                  )}
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-semibold tabular-nums">
                      {fmt.day.format(date)} {fmt.month.format(date)}
                    </span>
                    <span className="text-sm text-muted-foreground">
                      {fmt.weekday.format(date)} · {timeRange(event)}
                    </span>
                    <Badge
                      variant="outline"
                      className={cn('ml-auto shrink-0', style.badge)}
                    >
                      {t(`type_${event.type}`)}
                    </Badge>
                  </div>

                  <h3 className="mt-1.5 font-medium">{event.title}</h3>

                  {event.description && (
                    <p className="mt-1 whitespace-pre-line text-sm text-muted-foreground">
                      {event.description}
                    </p>
                  )}

                  <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-muted-foreground">
                    {event.location && (
                      <span className="flex items-center gap-1.5">
                        <MapPin className="h-4 w-4 shrink-0" />
                        {event.location}
                      </span>
                    )}
                    {event.state === 'today' && (
                      <Badge className="shrink-0">{t('today')}</Badge>
                    )}
                    {isNext && event.state !== 'today' && (
                      <Badge variant="secondary" className="shrink-0">
                        {t('next')}
                      </Badge>
                    )}
                  </div>

                  {(event.meetingUrl || event.lessonId) && (
                    <div className="mt-3 flex flex-wrap gap-2">
                      {event.meetingUrl && (
                        <Button asChild size="sm" variant="outline">
                          <a
                            href={event.meetingUrl}
                            target="_blank"
                            rel="noreferrer noopener"
                          >
                            <Video className="mr-2 h-4 w-4" />
                            {t('joinMeeting')}
                          </a>
                        </Button>
                      )}
                      {/* There is no student-facing lesson page — the syllabus
                          is where a lesson is actually opened from. */}
                      {event.lessonId && (
                        <Button asChild size="sm" variant="ghost">
                          <Link href="/syllabus">
                            {event.lessonTitle ?? t('openLesson')}
                            <ExternalLink className="ml-2 h-4 w-4" />
                          </Link>
                        </Button>
                      )}
                    </div>
                  )}
                </div>
              </li>
            );
          })}
        </ol>
      </CardContent>
    </Card>
  );
}
