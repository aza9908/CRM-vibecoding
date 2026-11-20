'use client';

import { useState } from 'react';
import { useFormatter, useTranslations } from 'next-intl';
import { Building2, Trophy } from 'lucide-react';
import type { StudentRatingPeriod } from '@lms/shared';
import { useStudentRating } from '@/lib/api/hooks';
import { Card, CardContent } from '@/components/ui/card';
import { Spinner } from '@/components/ui/spinner';
import { cn } from '@/lib/utils';
import { PointsRules, RankBadge } from './rating-parts';

/** A company tile (same look as the company tiles of the lessons board). */
function CompanyTile({
  active,
  onClick,
  label,
  count,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  count?: number;
}) {
  const t = useTranslations('rating');
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={cn(
        'flex min-h-[5.5rem] flex-col items-start justify-between gap-2 rounded-xl border-2 p-4 text-left shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
        active
          ? 'border-primary bg-primary text-primary-foreground'
          : 'border-border bg-card text-foreground hover:border-primary/60 hover:bg-primary/5',
      )}
    >
      <span className="flex w-full items-center gap-2">
        <Building2
          className={cn('h-5 w-5 shrink-0', active ? 'text-primary-foreground' : 'text-primary')}
          aria-hidden
        />
        <span className="truncate text-base font-semibold">{label}</span>
      </span>
      {count !== undefined ? (
        <span
          className={cn(
            'text-sm tabular-nums',
            active ? 'text-primary-foreground/85' : 'text-muted-foreground',
          )}
        >
          {t('studentsCount', { count })}
        </span>
      ) : null}
    </button>
  );
}

/**
 * «Рейтинг» for staff: pick a company (lesson category) and a period, see
 * the ranked students. Names and numbers only — no contacts.
 */
export function StaffRatingView() {
  const t = useTranslations('rating');
  const format = useFormatter();
  const [category, setCategory] = useState<string | null>(null);
  const [period, setPeriod] = useState<StudentRatingPeriod>('all');
  const { data, isLoading, isError, isFetching } = useStudentRating(category, period);

  const periods: Array<{ id: StudentRatingPeriod; label: string }> = [
    { id: 'all', label: t('periodAll') },
    { id: '30d', label: t('period30d') },
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold">
            <Trophy className="h-6 w-6 text-primary" aria-hidden />
            {t('title')}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">{t('subtitle')}</p>
        </div>
        <div className="flex w-fit gap-1 rounded-lg bg-muted p-1 text-sm" role="tablist">
          {periods.map((p) => (
            <button
              key={p.id}
              type="button"
              role="tab"
              aria-selected={period === p.id}
              onClick={() => setPeriod(p.id)}
              className={cn(
                'rounded-md px-3 py-1.5 font-medium transition-colors',
                period === p.id
                  ? 'bg-background shadow-sm'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      {data && data.categories.length > 0 ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4" role="tablist">
          <CompanyTile
            active={category === null}
            onClick={() => setCategory(null)}
            label={t('allCompanies')}
          />
          {data.categories.map((c) => (
            <CompanyTile
              key={c.name}
              active={category === c.name}
              onClick={() => setCategory((cur) => (cur === c.name ? null : c.name))}
              label={c.name}
              count={c.students}
            />
          ))}
        </div>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-[1fr_18rem]">
        <Card className="overflow-hidden">
          <CardContent className={cn('p-0', isFetching && !isLoading && 'opacity-70')}>
            {isLoading ? (
              <div className="flex justify-center py-16">
                <Spinner />
              </div>
            ) : isError ? (
              <p className="py-12 text-center text-sm text-muted-foreground">{t('loadError')}</p>
            ) : !data || data.rows.length === 0 ? (
              <div className="px-6 py-12 text-center">
                <p className="font-medium">{t('empty')}</p>
                <p className="mt-1 text-sm text-muted-foreground">{t('emptyHint')}</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="border-b bg-muted/50 text-left text-xs uppercase text-muted-foreground">
                    <tr>
                      <th className="px-3 py-2 font-medium">{t('colRank')}</th>
                      <th className="px-3 py-2 font-medium">{t('colName')}</th>
                      <th className="px-3 py-2 text-right font-medium">{t('colPoints')}</th>
                      <th className="hidden px-3 py-2 text-right font-medium sm:table-cell">{t('colLessons')}</th>
                      <th className="hidden px-3 py-2 text-right font-medium sm:table-cell">{t('colAnswered')}</th>
                      <th className="hidden px-3 py-2 text-right font-medium md:table-cell">{t('colRequired')}</th>
                      <th className="hidden px-3 py-2 text-right font-medium md:table-cell">{t('colLast')}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {data.rows.map((r, i) => (
                      <tr key={`${r.rank}-${r.name}-${i}`} className={cn(r.rank <= 3 && 'bg-primary/5')}>
                        <td className="px-3 py-2">
                          <RankBadge rank={r.rank} />
                        </td>
                        <td className="max-w-[16rem] truncate px-3 py-2 font-medium">{r.name}</td>
                        <td className="px-3 py-2 text-right font-semibold tabular-nums">{r.points}</td>
                        <td className="hidden px-3 py-2 text-right tabular-nums sm:table-cell">{r.lessons}</td>
                        <td className="hidden px-3 py-2 text-right tabular-nums sm:table-cell">{r.answered}</td>
                        <td className="hidden px-3 py-2 text-right tabular-nums md:table-cell">{r.requiredDone}</td>
                        <td className="hidden whitespace-nowrap px-3 py-2 text-right text-muted-foreground md:table-cell">
                          {r.lastActivity
                            ? format.dateTime(new Date(r.lastActivity), { day: 'numeric', month: 'short' })
                            : '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
        <PointsRules className="h-fit" />
      </div>
    </div>
  );
}
