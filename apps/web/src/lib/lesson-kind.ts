'use client';

import { useMemo } from 'react';
import { useLocale } from 'next-intl';
import type { LessonKind } from '@lms/shared';

/** i18n key (namespace `lessons`) for each curriculum position. */
export const KIND_LABEL_KEY: Record<LessonKind, string> = {
  intro: 'kindIntro',
  workshop: 'kindWorkshop',
  qa: 'kindQa',
  demo_day: 'kindDemoDay',
};

/** `Badge` variant for each curriculum position — each kind gets a distinct
 * color so a lesson list with mixed kinds (e.g. a QA session next to Demo
 * Day) reads at a glance instead of showing two identical-looking pills. */
export const KIND_BADGE_VARIANT: Record<
  LessonKind,
  'secondary' | 'outline' | 'default' | 'success'
> = {
  intro: 'outline',
  workshop: 'secondary',
  qa: 'default',
  demo_day: 'success',
};

/** The minimum lesson shape `compareLessons` needs to order a list. */
export interface OrderableLesson {
  kind: LessonKind | null;
  scheduledAt: string | null;
  order: number;
  /**
   * Position of this lesson's *module* in the curriculum. Only breaks ties
   * between two lessons that are BOTH unscheduled — two scheduled lessons
   * always compare by real date regardless of which module either is in
   * (a rescheduled make-up class in an earlier module must not jump ahead
   * of an on-time class in a later one just because of module order).
   * Lessons with no reliable module-order data can omit it (treated as 0).
   */
  moduleOrder?: number;
}

/**
 * Урок 0 (kind='intro') always first; then true chronological order across
 * the whole list (both dates set — module doesn't matter, a lesson on Sep 1
 * comes before one on Sep 5 no matter which module either belongs to);
 * scheduled lessons before unscheduled ones; and only when BOTH lessons are
 * unscheduled does it fall back to `moduleOrder` then `order`. Shared by
 * every lesson list — the teacher's own dashboard (`LessonsView`) and the
 * schedule/timeline view (`CurriculumTimeline`) — so they can't silently
 * drift into disagreeing on ordering. Safe to call on a list flattened
 * across modules, unlike a plain `order` comparison would be (`order` is
 * only a position within its own module's lesson list — nothing ties it to
 * a global sequence, and more than one module could technically carry its
 * own kind='intro' lesson).
 */
export function compareLessons(a: OrderableLesson, b: OrderableLesson): number {
  const aIntro = a.kind === 'intro' ? 0 : 1;
  const bIntro = b.kind === 'intro' ? 0 : 1;
  if (aIntro !== bIntro) return aIntro - bIntro;
  if (a.scheduledAt && b.scheduledAt) {
    return new Date(a.scheduledAt).getTime() - new Date(b.scheduledAt).getTime();
  }
  if (a.scheduledAt) return -1;
  if (b.scheduledAt) return 1;
  const aModuleOrder = a.moduleOrder ?? 0;
  const bModuleOrder = b.moduleOrder ?? 0;
  if (aModuleOrder !== bModuleOrder) return aModuleOrder - bModuleOrder;
  return a.order - b.order;
}

/** Shared "day month, HH:mm" formatter for lesson dates — one instance per
 * component tree, not one per lesson row. */
export function useLessonDateFormatter(): Intl.DateTimeFormat {
  const locale = useLocale();
  return useMemo(
    () =>
      new Intl.DateTimeFormat(locale, {
        day: 'numeric',
        month: 'long',
        hour: '2-digit',
        minute: '2-digit',
      }),
    [locale],
  );
}

/**
 * Formats a lesson's `scheduledAt` for display, or `null` for "not
 * scheduled yet" (absent, or an unparseable value) — callers render their
 * own "Дата уточняется"-style fallback for `null`. Guards against
 * `Intl.DateTimeFormat.format` throwing on an invalid date, which would
 * otherwise crash the whole card's render with no error boundary around it.
 */
export function formatLessonDate(
  scheduledAt: string | null,
  formatter: Intl.DateTimeFormat,
): string | null {
  if (!scheduledAt) return null;
  const date = new Date(scheduledAt);
  if (Number.isNaN(date.getTime())) return null;
  return formatter.format(date);
}
