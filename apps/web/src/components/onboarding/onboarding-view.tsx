'use client';

import { useTranslations } from 'next-intl';
import { PlayCircle } from 'lucide-react';
import { Link } from '@/i18n/routing';
import { useCurriculum } from '@/lib/api/hooks';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';

/**
 * "Onboarding" — the org's `kind: 'intro'` lesson (lesson 0, "пройти урок до
 * начала обучения"). Reuses `useCurriculum()` (no new endpoint) and links
 * straight into the existing lesson-preview route.
 */
export function OnboardingView() {
  const t = useTranslations('onboarding');
  const tc = useTranslations('common');
  const { data, isLoading, isError } = useCurriculum();

  const introLesson = data?.modules
    .flatMap((m) => m.lessons)
    .find((l) => l.kind === 'intro');

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{t('title')}</h1>
        <p className="text-sm text-muted-foreground">{t('subtitle')}</p>
      </div>

      {isLoading ? (
        <div className="flex items-center gap-2 py-8 text-muted-foreground">
          <Spinner />
          {tc('loading')}
        </div>
      ) : isError ? (
        <p className="py-8 text-destructive">{tc('error')}</p>
      ) : introLesson ? (
        <Card>
          <CardContent className="flex flex-wrap items-center justify-between gap-4 py-6">
            <div className="min-w-0">
              <div className="font-medium">{introLesson.title}</div>
            </div>
            <Button asChild>
              <Link href={`/editor/${introLesson.id}/preview`}>
                <PlayCircle className="h-4 w-4" />
                {t('openLesson')}
              </Link>
            </Button>
          </CardContent>
        </Card>
      ) : (
        <p className="py-8 text-muted-foreground">{t('empty')}</p>
      )}
    </div>
  );
}
