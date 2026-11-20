'use client';

import { useTranslations } from 'next-intl';
import { Trophy } from 'lucide-react';
import { useMyStudentRating } from '@/lib/api/hooks';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Spinner } from '@/components/ui/spinner';
import { PointsRules, TopList } from './rating-parts';

/**
 * «Мой рейтинг» on the student portal: my points, my place in the
 * organization and its top 10. `showRules` adds the point rules below.
 */
export function MyRatingCard({ showRules = false }: { showRules?: boolean }) {
  const t = useTranslations('rating');
  const { data, isLoading, isError } = useMyStudentRating();

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Trophy className="h-5 w-5 text-primary" aria-hidden />
          {t('myTitle')}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-5">
        {isLoading ? (
          <div className="flex justify-center py-6">
            <Spinner />
          </div>
        ) : isError || !data ? (
          <p className="text-sm text-muted-foreground">{t('loadError')}</p>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-lg bg-primary/10 p-4">
                <div className="text-3xl font-semibold tabular-nums text-primary">{data.me.points}</div>
                <div className="text-sm text-muted-foreground">{t('myPoints')}</div>
              </div>
              <div className="rounded-lg bg-muted p-4">
                <div className="text-3xl font-semibold tabular-nums">
                  {data.me.rank != null
                    ? t('placeOf', { rank: data.me.rank, total: data.me.total })
                    : '—'}
                </div>
                <div className="text-sm text-muted-foreground">{t('myPlace')}</div>
              </div>
            </div>
            {data.me.rank == null ? (
              <p className="text-sm text-muted-foreground">{t('noPointsYet')}</p>
            ) : null}
            <div>
              <div className="mb-1 text-sm font-semibold">{t('topTitle')}</div>
              <TopList entries={data.top} myRank={data.me.rank} />
            </div>
          </>
        )}
        {showRules ? <PointsRules /> : null}
      </CardContent>
    </Card>
  );
}
