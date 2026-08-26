'use client';

import { useMemo } from 'react';
import { useTranslations } from 'next-intl';
import { CheckCircle2, Circle, CircleDot } from 'lucide-react';
import type { CurriculumLesson, LessonKind, ProgressStatus } from '@lms/shared';
import { useCurriculum } from '@/lib/api/hooks';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Spinner } from '@/components/ui/spinner';

const KIND_LABEL_KEY: Record<LessonKind, string> = {
  intro: 'kindIntro',
  workshop: 'kindWorkshop',
  qa: 'kindQa',
  demo_day: 'kindDemoDay',
};

const KIND_BADGE_VARIANT: Record<LessonKind, 'secondary' | 'outline' | 'default'> = {
  intro: 'outline',
  workshop: 'secondary',
  qa: 'default',
  demo_day: 'default',
};

function TimelineMarker({ status }: { status?: ProgressStatus }) {
  if (status === 'completed') {
    return (
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-success text-success-foreground ring-4 ring-background">
        <CheckCircle2 className="h-4 w-4" />
      </span>
    );
  }
  if (status === 'started') {
    return (
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground ring-4 ring-background">
        <CircleDot className="h-4 w-4" />
      </span>
    );
  }
  return (
    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground ring-4 ring-background">
      <Circle className="h-4 w-4" />
    </span>
  );
}

/**
 * Per-company learning timeline — every lesson from first to last, including
 * QA sessions and Demo day, in a single flattened chronological list ordered
 * by `order`. Reuses `useCurriculum()` (already fetched by the cabinet /
 * syllabus / lessons views, so TanStack Query dedupes the request) rather
 * than a new endpoint. Embedded in the cabinet and reused as the standalone
 * "Расписание занятий" page.
 */
export function CurriculumTimeline() {
  const t = useTranslations('lessons');
  const ts = useTranslations('syllabus');
  const tc = useTranslations('common');
  const { data, isLoading, isError } = useCurriculum();

  const lessons = useMemo(() => {
    const all = (data?.modules ?? []).flatMap((m) => m.lessons);
    return [...all].sort((a, b) => a.order - b.order);
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
    <ol className="relative flex flex-col gap-4 border-l pl-6">
      {lessons.map((lesson: CurriculumLesson) => (
        <li key={lesson.id} className="relative">
          <span className="absolute -left-[calc(1.5rem+1px)] top-0">
            <TimelineMarker status={lesson.progressStatus} />
          </span>
          <Card>
            <CardHeader className="py-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <CardTitle className="text-base">{lesson.title}</CardTitle>
                {lesson.kind ? (
                  <Badge variant={KIND_BADGE_VARIANT[lesson.kind]}>
                    {t(KIND_LABEL_KEY[lesson.kind])}
                  </Badge>
                ) : null}
              </div>
            </CardHeader>
            {lesson.progressStatus ? (
              <CardContent className="py-0 pb-3 text-sm text-muted-foreground">
                {lesson.progressStatus === 'completed'
                  ? ts('progressCompleted')
                  : ts('progressStarted')}
              </CardContent>
            ) : null}
          </Card>
        </li>
      ))}
    </ol>
  );
}
