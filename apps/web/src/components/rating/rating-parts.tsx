'use client';

import { useTranslations } from 'next-intl';
import { Sparkles } from 'lucide-react';
import { STUDENT_RATING_POINTS, type StudentRatingTopEntry } from '@lms/shared';
import { cn } from '@/lib/utils';

const MEDALS: Record<number, string> = { 1: '🥇', 2: '🥈', 3: '🥉' };

/** Place badge: a medal for the podium, the number otherwise. */
export function RankBadge({ rank, className }: { rank: number; className?: string }) {
  const medal = MEDALS[rank];
  return (
    <span
      className={cn(
        'inline-flex w-8 shrink-0 justify-center tabular-nums',
        medal ? 'text-lg leading-none' : 'text-sm font-medium text-muted-foreground',
        className,
      )}
      aria-label={String(rank)}
    >
      {medal ?? rank}
    </span>
  );
}

/** «How points are earned» — the rules come from @lms/shared. */
export function PointsRules({ className }: { className?: string }) {
  const t = useTranslations('rating');
  const rules = [
    t('ruleAnswered', { points: STUDENT_RATING_POINTS.answeredBlock }),
    t('ruleRequired', { points: STUDENT_RATING_POINTS.requiredBlock }),
    t('ruleAllRequired', { points: STUDENT_RATING_POINTS.allRequiredBonus }),
    t('ruleLesson', { points: STUDENT_RATING_POINTS.lessonAttended }),
  ];
  return (
    <div className={cn('rounded-xl border bg-muted/40 p-4', className)}>
      <div className="mb-2 flex items-center gap-2 text-sm font-semibold">
        <Sparkles className="h-4 w-4 text-primary" aria-hidden />
        {t('rulesTitle')}
      </div>
      <ul className="space-y-1 text-sm text-muted-foreground">
        {rules.map((r) => (
          <li key={r}>{r}</li>
        ))}
      </ul>
    </div>
  );
}

/** Compact leaders list (names + points only). `myRank` highlights the caller's place. */
export function TopList({
  entries,
  myRank,
  compact,
}: {
  entries: StudentRatingTopEntry[];
  myRank?: number | null;
  compact?: boolean;
}) {
  const t = useTranslations('rating');
  if (entries.length === 0) {
    return <p className="py-4 text-center text-sm text-muted-foreground">{t('empty')}</p>;
  }
  return (
    <ol className="divide-y">
      {entries.map((e, i) => (
        <li
          key={`${e.rank}-${e.name}-${i}`}
          className={cn(
            'flex items-center gap-2',
            compact ? 'py-1.5' : 'py-2',
            myRank != null && e.rank === myRank && 'rounded-md bg-primary/5',
          )}
        >
          <RankBadge rank={e.rank} />
          <span className="min-w-0 flex-1 truncate text-sm">{e.name}</span>
          <span className="shrink-0 text-sm font-semibold tabular-nums">
            {t('pointsShort', { count: e.points })}
          </span>
        </li>
      ))}
    </ol>
  );
}
