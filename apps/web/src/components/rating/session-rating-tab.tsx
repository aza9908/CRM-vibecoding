'use client';

import { useTranslations } from 'next-intl';
import { useSessionStudentRating } from '@/lib/api/hooks';
import { Spinner } from '@/components/ui/spinner';
import { PointsRules, TopList } from './rating-parts';

/**
 * «Рейтинг» tab of the live lesson: the company's top 10 and «Ваши баллы».
 * Polls once a minute — points change slowly, no realtime needed.
 */
export function SessionRatingTab({
  sessionId,
  asParticipant,
}: {
  sessionId: string;
  asParticipant: boolean;
}) {
  const t = useTranslations('rating');
  const { data, isLoading, isError } = useSessionStudentRating(sessionId, {
    participant: asParticipant,
  });

  if (isLoading) {
    return (
      <div className="flex justify-center py-10">
        <Spinner />
      </div>
    );
  }
  if (isError || !data) {
    return <p className="py-10 text-center text-sm text-muted-foreground">{t('loadError')}</p>;
  }
  return (
    <div className="space-y-4">
      {data.me ? (
        <div className="grid grid-cols-2 gap-2">
          <div className="rounded-lg bg-primary/10 p-3">
            <div className="text-2xl font-semibold tabular-nums text-primary">{data.me.points}</div>
            <div className="text-xs text-muted-foreground">{t('yourPoints')}</div>
          </div>
          <div className="rounded-lg bg-muted p-3">
            <div className="text-2xl font-semibold tabular-nums">
              {data.me.rank != null ? t('placeOf', { rank: data.me.rank, total: data.me.total }) : '—'}
            </div>
            <div className="text-xs text-muted-foreground">{t('yourPlace')}</div>
          </div>
        </div>
      ) : null}
      <div>
        <div className="text-sm font-semibold">
          {data.category ? t('sessionScope', { category: data.category }) : t('sessionScopeAll')}
        </div>
        <div className="mb-1 text-xs text-muted-foreground">{t('refreshHint')}</div>
        <TopList entries={data.top} myRank={data.me?.rank ?? null} compact />
      </div>
      <PointsRules className="p-3" />
    </div>
  );
}
