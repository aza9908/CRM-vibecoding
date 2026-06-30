'use client';

import { useTranslations } from 'next-intl';
import { CheckCircle2, Circle, CircleDot, Target } from 'lucide-react';
import type {
  CurriculumLesson,
  CurriculumModule,
  ProgressStatus,
} from '@lms/shared';
import { useCurriculum } from '@/lib/api/hooks';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Spinner } from '@/components/ui/spinner';
import { Button } from '@/components/ui/button';

function ProgressBadge({ status }: { status?: ProgressStatus }) {
  const t = useTranslations('syllabus');
  if (status === 'completed') {
    return (
      <Badge variant="success" className="gap-1">
        <CheckCircle2 className="h-3 w-3" />
        {t('progressCompleted')}
      </Badge>
    );
  }
  if (status === 'started') {
    return (
      <Badge variant="secondary" className="gap-1">
        <CircleDot className="h-3 w-3" />
        {t('progressStarted')}
      </Badge>
    );
  }
  return (
    <Badge variant="outline" className="gap-1">
      <Circle className="h-3 w-3" />
      {t('noProgress')}
    </Badge>
  );
}

/** Small status glyph shown at the start of each lesson row. */
function LessonStatusIcon({ status }: { status?: ProgressStatus }) {
  if (status === 'completed') {
    return <CheckCircle2 className="h-4 w-4 shrink-0 text-success" />;
  }
  if (status === 'started') {
    return <CircleDot className="h-4 w-4 shrink-0 text-primary" />;
  }
  return <Circle className="h-4 w-4 shrink-0 text-muted-foreground" />;
}

function LessonRow({ lesson }: { lesson: CurriculumLesson }) {
  const t = useTranslations('syllabus');
  const isStarted = lesson.progressStatus === 'started';
  return (
    <li
      className={
        isStarted
          ? 'rounded-lg border border-primary bg-primary/5 p-3 ring-1 ring-primary/20'
          : 'rounded-lg border bg-card p-3'
      }
    >
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-2 font-medium">
          <LessonStatusIcon status={lesson.progressStatus} />
          {lesson.title}
        </span>
        <ProgressBadge status={lesson.progressStatus} />
      </div>
      {lesson.outcomes.length > 0 ? (
        <div className="mt-2 pl-6">
          <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            {t('outcomes')}
          </span>
          <ul className="mt-1 flex flex-col gap-1">
            {lesson.outcomes.map((o) => (
              <li
                key={o.id}
                className="flex items-center gap-2 text-sm text-muted-foreground"
              >
                <Target className="h-3.5 w-3.5 shrink-0" />
                {o.title}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </li>
  );
}

/** Derive a module's overall progress from its lessons (presentation only). */
function moduleStatus(module: CurriculumModule): ProgressStatus | undefined {
  const statuses = module.lessons.map((l) => l.progressStatus);
  if (statuses.length > 0 && statuses.every((s) => s === 'completed')) {
    return 'completed';
  }
  if (statuses.some((s) => s === 'completed' || s === 'started')) {
    return 'started';
  }
  return undefined;
}

/** Circular timeline marker for a module. */
function ModuleMarker({ status }: { status?: ProgressStatus }) {
  if (status === 'completed') {
    return (
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-success text-success-foreground">
        <CheckCircle2 className="h-5 w-5" />
      </span>
    );
  }
  if (status === 'started') {
    return (
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground">
        <CircleDot className="h-5 w-5" />
      </span>
    );
  }
  return (
    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
      <Circle className="h-5 w-5" />
    </span>
  );
}

function ModuleCard({ module }: { module: CurriculumModule }) {
  const status = moduleStatus(module);
  return (
    <Card className="overflow-hidden">
      <CardHeader>
        <div className="flex items-center gap-3">
          <ModuleMarker status={status} />
          <div className="flex flex-col gap-1">
            {module.code ? (
              <Badge variant="outline" className="w-fit">
                {module.code}
              </Badge>
            ) : null}
            <CardTitle>{module.title}</CardTitle>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <ul className="flex flex-col gap-2 sm:pl-12">
          {module.lessons.map((lesson) => (
            <LessonRow key={lesson.id} lesson={lesson} />
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

/** Curriculum tree: course → modules → lessons (+ outcomes & progress). */
export function SyllabusView() {
  const t = useTranslations('syllabus');
  const tc = useTranslations('common');
  const { data, isLoading, isError, refetch } = useCurriculum();

  return (
    <main className="container py-8">
      <div className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight">{t('title')}</h1>
        {data?.course ? (
          <p className="mt-1 text-muted-foreground">{data.course.title}</p>
        ) : null}
      </div>

      {isLoading ? (
        <div className="flex items-center gap-2 text-muted-foreground">
          <Spinner />
          {tc('loading')}
        </div>
      ) : isError ? (
        <div className="flex flex-col items-start gap-3">
          <p className="text-destructive">{tc('error')}</p>
          <Button variant="outline" onClick={() => void refetch()}>
            {tc('retry')}
          </Button>
        </div>
      ) : !data || data.modules.length === 0 ? (
        <p className="text-muted-foreground">{tc('empty')}</p>
      ) : (
        <div className="flex flex-col gap-4">
          {data.modules.map((module) => (
            <ModuleCard key={module.id} module={module} />
          ))}
        </div>
      )}
    </main>
  );
}
