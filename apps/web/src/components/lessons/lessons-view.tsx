'use client';

import { useEffect, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { FolderOpen, Plus, Search, X } from 'lucide-react';
import { LESSON_CATEGORY_PRESETS } from '@lms/shared';
import { useCurriculum, useLessons, useLiveSessions } from '@/lib/api/hooks';
import type { Lesson, LiveSessionSummary } from '@/lib/api/types';
import { compareLessons, useLessonDateFormatter } from '@/lib/lesson-kind';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { LessonCard } from './lesson-card';
import { CreateLessonDialog } from './create-lesson-dialog';

/** Group key for lessons without a category. */
const NONE = '__none__';
/** Remembered category tab. */
const CATEGORY_KEY = 'lms-lessons-category';

type OrderedLesson = Lesson & { moduleOrder: number };

interface Group {
  /** Category name, or `NONE` for uncategorised lessons. */
  key: string;
  label: string;
  lessons: OrderedLesson[];
}

/**
 * Teacher lessons dashboard: lessons grouped into one column per category
 * (usually the client company), with search and per-lesson actions. The
 * by-category board is the only view — there is no flat «all lessons» list.
 *
 * `GET /lessons` (guarded server-side to teacher/methodist/admin, unlike
 * `/curriculum`) is the primary — and access-gating — data source;
 * `useCurriculum()` is fetched only as a secondary, deduped lookup for each
 * lesson's real `modules.order` (which the flat lessons endpoint doesn't
 * expose), so unscheduled lessons from different modules sort the same way
 * here as in the schedule/timeline view without loosening who can even load
 * this page.
 */
export function LessonsView() {
  const t = useTranslations('lessons');
  const tc = useTranslations('common');
  const { data: lessons, isLoading, isError, refetch } = useLessons();
  const { data: curriculum } = useCurriculum();
  const { data: liveSessions } = useLiveSessions();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [dialogCategory, setDialogCategory] = useState<string | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const [query, setQuery] = useState('');
  const dateFormatter = useLessonDateFormatter();

  const archivedCount = lessons?.filter((l) => l.archived).length ?? 0;

  const liveByLesson = useMemo(
    () =>
      new Map<string, LiveSessionSummary>(
        (liveSessions ?? [])
          .filter((s) => s.lessonId)
          .map((s) => [s.lessonId as string, s]),
      ),
    [liveSessions],
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

  const orderedLessons = useMemo<OrderedLesson[]>(() => {
    const visible = (lessons ?? []).filter((l) => showArchived || !l.archived);
    const withModuleOrder = visible.map((l) => ({
      ...l,
      // `getCurriculumTree` excludes archived lessons, so the synthetic
      // 'unassigned' module (and any real module whose only lessons are
      // now archived) may not appear in `curriculum.modules` at all once
      // "Show archived" reveals a lesson like that. A missing lookup here
      // must NOT fall through to `compareLessons`'s own `moduleOrder ?? 0`
      // — that reads as "first module" — so an actual miss is pinned last
      // instead of masquerading as module order 0.
      moduleOrder:
        moduleOrderById.get(l.moduleId ?? 'unassigned') ?? Number.MAX_SAFE_INTEGER,
    }));
    return [...withModuleOrder].sort(compareLessons);
  }, [lessons, showArchived, moduleOrderById]);

  /** Categories offered in pickers: presets first, then the org's own. */
  const categoryOptions = useMemo(() => {
    const presets: string[] = [...LESSON_CATEGORY_PRESETS];
    const own = new Set<string>();
    for (const l of lessons ?? []) {
      if (l.category && !presets.includes(l.category)) own.add(l.category);
    }
    return [...presets, ...[...own].sort((a, b) => a.localeCompare(b))];
  }, [lessons]);

  const groups = useMemo<Group[]>(() => {
    const q = query.trim().toLowerCase();
    const matches = orderedLessons.filter(
      (l) => !q || l.title.toLowerCase().includes(q),
    );
    const byKey = new Map<string, OrderedLesson[]>();
    for (const l of matches) {
      const key = l.category ?? NONE;
      const list = byKey.get(key);
      if (list) list.push(l);
      else byKey.set(key, [l]);
    }
    const result: Group[] = [];
    for (const c of categoryOptions) {
      const list = byKey.get(c);
      // Empty preset columns stay visible once the org files lessons by
      // category, so "Pingwin" has a place before its first lesson exists.
      // (An org's own category with nothing visible — e.g. only archived
      // lessons — is not shown as an empty column.)
      // Only categories that have lessons get a tab (an empty company is
      // still offered when creating a lesson).
      if (list) {
        result.push({ key: c, label: c, lessons: list ?? [] });
      }
    }
    const none = byKey.get(NONE);
    if (none) result.push({ key: NONE, label: t('categoryNone'), lessons: none });
    return result;
  }, [orderedLessons, query, categoryOptions, t]);

  const hasLessons = (lessons?.length ?? 0) > 0;

  // The chosen category (remembered in this browser). Falls back to the
  // first category that has lessons.
  const [chosen, setChosen] = useState<string | null>(null);
  useEffect(() => {
    try {
      setChosen(window.localStorage.getItem(CATEGORY_KEY));
    } catch {
      /* preference only */
    }
  }, []);
  function choose(key: string) {
    setChosen(key);
    try {
      window.localStorage.setItem(CATEGORY_KEY, key);
    } catch {
      /* preference only */
    }
  }
  const current =
    groups.find((g) => g.key === chosen && (g.lessons.length > 0 || !query)) ??
    groups.find((g) => g.lessons.length > 0) ??
    groups[0] ??
    null;

  function openCreate(category: string | null) {
    setDialogCategory(category);
    setDialogOpen(true);
  }

  const cards = (list: OrderedLesson[]) =>
    list.map((lesson) => (
      <LessonCard
        key={lesson.id}
        lesson={lesson}
        activeSession={liveByLesson.get(lesson.id)}
        dateFormatter={dateFormatter}
        categories={categoryOptions}
      />
    ));

  return (
    <>
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">
            {t('title')}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {t('staffHint')}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {archivedCount > 0 ? (
            <Button
              variant="outline"
              onClick={() => setShowArchived((v) => !v)}
              aria-pressed={showArchived}
            >
              {showArchived ? t('hideArchived') : t('showArchived')} (
              {archivedCount})
            </Button>
          ) : null}
          <Button onClick={() => openCreate(null)}>
            <Plus />
            {t('newLesson')}
          </Button>
        </div>
      </div>

      {hasLessons ? (
        <div className="mb-6">
          <div className="relative max-w-md">
            <Search
              className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden
            />
            <Input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t('searchPlaceholder')}
              aria-label={t('searchPlaceholder')}
              className="pl-9 pr-9"
            />
            {query ? (
              <button
                type="button"
                onClick={() => setQuery('')}
                aria-label={tc('close')}
                className="absolute right-2 top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-full text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <X className="h-4 w-4" />
              </button>
            ) : null}
          </div>
        </div>
      ) : null}

      {isLoading ? (
        <LessonsSkeleton label={tc('loading')} />
      ) : isError ? (
        <div className="flex flex-col items-start gap-3 rounded-lg border bg-card p-6 shadow-sm">
          <p className="text-destructive">{tc('error')}</p>
          <Button variant="outline" onClick={() => void refetch()}>
            {tc('retry')}
          </Button>
        </div>
      ) : !hasLessons ? (
        <EmptyState
          title={t('noLessons')}
          hint={t('noLessonsHint')}
          action={
            <Button onClick={() => openCreate(null)}>
              <Plus />
              {t('newLesson')}
            </Button>
          }
        />
      ) : groups.length === 0 ? (
        // Nothing matches the search (or every lesson is archived and the
        // archive is hidden).
        <EmptyState
          title={query ? t('nothingFound') : t('noLessons')}
          hint={query ? t('nothingFoundHint') : t('noLessonsHint')}
          action={
            query ? (
              <Button variant="outline" onClick={() => setQuery('')}>
                {t('clearSearch')}
              </Button>
            ) : (
              <Button onClick={() => openCreate(null)}>
                <Plus />
                {t('newLesson')}
              </Button>
            )
          }
        />
      ) : (
        <>
          {/* Categories (companies) as tabs; only the chosen one's lessons below. */}
          <div
            role="tablist"
            aria-label={t('category')}
            className="-mx-4 mb-5 flex gap-2 overflow-x-auto px-4 pb-1 sm:mx-0 sm:flex-wrap sm:px-0"
          >
            {groups.map((g) => {
              const active = g.key === current?.key;
              return (
                <button
                  key={g.key}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  onClick={() => choose(g.key)}
                  className={cn(
                    'inline-flex h-10 shrink-0 items-center gap-2 rounded-full border px-4 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
                    active
                      ? 'border-primary bg-primary text-primary-foreground'
                      : 'bg-background text-foreground hover:bg-accent',
                  )}
                >
                  {g.label}
                  <span
                    className={cn(
                      'rounded-full px-1.5 text-xs tabular-nums',
                      active ? 'bg-primary-foreground/20 text-primary-foreground' : 'bg-muted text-muted-foreground',
                    )}
                  >
                    {g.lessons.length}
                  </span>
                </button>
              );
            })}
          </div>
          {current ? (
            <section role="tabpanel" aria-label={current.label}>
              <div className="mb-3 flex items-center justify-between gap-3">
                <h2 className="text-lg font-semibold">
                  {current.label}{' '}
                  <span className="text-sm font-normal text-muted-foreground">
                    · {t('lessonsCount', { count: current.lessons.length })}
                  </span>
                </h2>
              </div>
              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                <button
                  type="button"
                  onClick={() => openCreate(current.key === NONE ? null : current.key)}
                  className="flex min-h-[8rem] items-center justify-center gap-2 rounded-lg border border-dashed bg-background/60 px-3 py-6 text-sm font-medium text-muted-foreground transition-colors hover:border-primary/50 hover:bg-primary/5 hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <Plus className="h-4 w-4" />
                  {t('categoryEmptyAdd')}
                </button>
                {cards(current.lessons)}
              </div>
            </section>
          ) : null}
        </>
      )}

      <CreateLessonDialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        categories={categoryOptions}
        defaultCategory={dialogCategory}
      />
    </>
  );
}

function EmptyState({
  title,
  hint,
  action,
}: {
  title: string;
  hint?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed bg-card/50 px-6 py-14 text-center">
      <span className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-primary">
        <FolderOpen className="h-6 w-6" aria-hidden />
      </span>
      <p className="text-base font-semibold">{title}</p>
      {hint ? (
        <p className="max-w-sm text-sm text-muted-foreground">{hint}</p>
      ) : null}
      {action ? <div className="mt-1">{action}</div> : null}
    </div>
  );
}

/** Placeholder columns while the list loads — keeps the layout from jumping. */
function LessonsSkeleton({ label }: { label: string }) {
  return (
    <div
      className="grid gap-4 md:grid-cols-2 xl:grid-cols-3"
      role="status"
      aria-label={label}
    >
      {[0, 1, 2].map((i) => (
        <div key={i} className="space-y-3 rounded-xl border bg-card p-5">
          <div className="h-3 w-24 animate-pulse rounded bg-muted" />
          <div className="h-5 w-3/4 animate-pulse rounded bg-muted" />
          <div className="grid grid-cols-2 gap-2 pt-2">
            <div className="h-10 animate-pulse rounded-md bg-muted" />
            <div className="h-10 animate-pulse rounded-md bg-muted" />
          </div>
        </div>
      ))}
    </div>
  );
}
