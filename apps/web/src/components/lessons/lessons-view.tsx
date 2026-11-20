'use client';

import { useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { ChevronDown, FolderOpen, Plus, Search, X } from 'lucide-react';
import { LESSON_CATEGORY_PRESETS } from '@lms/shared';
import { useCurriculum, useLessons, useLiveSessions } from '@/lib/api/hooks';
import type { Lesson, LiveSessionSummary } from '@/lib/api/types';
import { compareLessons, useLessonDateFormatter } from '@/lib/lesson-kind';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { LessonCard } from './lesson-card';
import { CreateLessonDialog } from './create-lesson-dialog';

/** Filter value for "every category" / "lessons without a category". */
const ALL = '__all__';
const NONE = '__none__';

type OrderedLesson = Lesson & { moduleOrder: number };

interface Group {
  /** Category name, or `NONE` for uncategorised lessons. */
  key: string;
  label: string;
  lessons: OrderedLesson[];
}

/**
 * Teacher lessons dashboard: lessons grouped into one column per category
 * (usually the client company), with search, a category filter and
 * per-lesson actions.
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
  const [filter, setFilter] = useState<string>(ALL);
  const [query, setQuery] = useState('');
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
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

  const usesCategories = (lessons ?? []).some((l) => l.category);

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
      const preset = (LESSON_CATEGORY_PRESETS as readonly string[]).includes(c);
      if (list || (usesCategories && !q && preset)) {
        result.push({ key: c, label: c, lessons: list ?? [] });
      }
    }
    const none = byKey.get(NONE);
    if (none) result.push({ key: NONE, label: t('categoryNone'), lessons: none });
    return result;
  }, [orderedLessons, query, categoryOptions, usesCategories, t]);

  const shownGroups =
    filter === ALL ? groups : groups.filter((g) => g.key === filter);
  const totalShown = shownGroups.reduce((n, g) => n + g.lessons.length, 0);
  const hasLessons = (lessons?.length ?? 0) > 0;
  const board = filter === ALL && usesCategories;

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
          <Button
            onClick={() => openCreate(filter !== ALL && filter !== NONE ? filter : null)}
          >
            <Plus />
            {t('newLesson')}
          </Button>
        </div>
      </div>

      {hasLessons ? (
        <div className="mb-6 flex flex-col gap-3">
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
          {groups.length > 1 || filter !== ALL ? (
            <div
              className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 sm:mx-0 sm:flex-wrap sm:px-0"
              role="tablist"
              aria-label={t('category')}
            >
              {/* No «All» chip: the board already shows everything. A chip
                  narrows to one company; pressing it again shows all. */}
              {groups.map((g) => (
                <FilterChip
                  key={g.key}
                  active={filter === g.key}
                  onClick={() => setFilter((cur) => (cur === g.key ? ALL : g.key))}
                  label={g.label}
                  count={g.lessons.length}
                />
              ))}
            </div>
          ) : null}
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
      ) : totalShown === 0 && !board ? (
        <EmptyState
          title={query ? t('nothingFound') : t('categoryEmpty')}
          hint={query ? t('nothingFoundHint') : undefined}
          action={
            query ? (
              <Button variant="outline" onClick={() => setQuery('')}>
                {t('clearSearch')}
              </Button>
            ) : (
              <Button
                onClick={() => openCreate(filter !== ALL && filter !== NONE ? filter : null)}
              >
                <Plus />
                {t('newLesson')}
              </Button>
            )
          }
        />
      ) : board ? (
        // One column per category: stacked collapsible sections on phones; from
        // `lg` up a board whose columns wrap to the next row, so nothing is
        // ever cut off at the right edge.
        <div className="flex flex-col gap-4 lg:grid lg:grid-cols-[repeat(auto-fill,minmax(19rem,1fr))] lg:items-start">
          {shownGroups.map((g) => {
            const isCollapsed = collapsed[g.key] ?? false;
            const addTo = g.key === NONE ? null : g.key;
            return (
              <section
                key={g.key}
                aria-label={g.label}
                className="flex min-w-0 flex-col rounded-xl border bg-muted/40"
              >
                <div className="flex items-center gap-2 px-3 py-2.5">
                  <button
                    type="button"
                    onClick={() =>
                      setCollapsed((c) => ({ ...c, [g.key]: !isCollapsed }))
                    }
                    aria-expanded={!isCollapsed}
                    className="flex min-w-0 flex-1 items-center gap-2 rounded-md py-1 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring lg:pointer-events-none"
                  >
                    <ChevronDown
                      className={cn(
                        'h-4 w-4 shrink-0 text-muted-foreground transition-transform lg:hidden',
                        isCollapsed && '-rotate-90',
                      )}
                      aria-hidden
                    />
                    <h2 className="truncate text-sm font-semibold">{g.label}</h2>
                    <span className="rounded-full bg-background px-2 py-0.5 text-xs font-medium tabular-nums text-muted-foreground">
                      {g.lessons.length}
                    </span>
                  </button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 shrink-0 text-muted-foreground"
                    onClick={() => openCreate(addTo)}
                    aria-label={`${t('newLesson')} — ${g.label}`}
                    title={t('newLesson')}
                  >
                    <Plus />
                  </Button>
                </div>
                <div
                  className={cn(
                    'flex-col gap-3 px-3 pb-3',
                    isCollapsed ? 'hidden lg:flex' : 'flex',
                  )}
                >
                  {/* «Add a lesson» always comes first in a column. */}
                  <button
                    type="button"
                    onClick={() => openCreate(addTo)}
                    className={cn(
                      'flex items-center justify-center gap-2 rounded-lg border border-dashed bg-background/60 px-3 text-sm font-medium text-muted-foreground transition-colors hover:border-primary/50 hover:bg-primary/5 hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                      g.lessons.length > 0 ? 'py-3' : 'py-6',
                    )}
                  >
                    <Plus className="h-4 w-4" />
                    {t('categoryEmptyAdd')}
                  </button>
                  {cards(g.lessons)}
                </div>
              </section>
            );
          })}
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          <button
            type="button"
            onClick={() => openCreate(filter !== ALL && filter !== NONE ? filter : null)}
            className="flex min-h-[8rem] items-center justify-center gap-2 rounded-lg border border-dashed bg-background/60 px-3 py-6 text-sm font-medium text-muted-foreground transition-colors hover:border-primary/50 hover:bg-primary/5 hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <Plus className="h-4 w-4" />
            {t('categoryEmptyAdd')}
          </button>
          {cards(shownGroups.flatMap((g) => g.lessons))}
        </div>
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

function FilterChip({
  active,
  onClick,
  label,
  count,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  count: number;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={cn(
        'inline-flex h-9 shrink-0 items-center gap-2 rounded-full border px-3.5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
        active
          ? 'border-primary bg-primary text-primary-foreground'
          : 'bg-background text-foreground hover:bg-accent',
      )}
    >
      {label}
      <span
        className={cn(
          'text-xs tabular-nums',
          active ? 'text-primary-foreground/80' : 'text-muted-foreground',
        )}
      >
        {count}
      </span>
    </button>
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
