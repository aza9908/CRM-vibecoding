'use client';

import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/routing';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';

export type SessionBannerKind = 'ended' | 'notFound';

/**
 * Full-screen fallback shown when a session is not available to the viewer:
 * either it could not be loaded (notFound) or the teacher ended it (ended).
 */
export function SessionStateBanner({
  kind,
  homeHref = '/',
}: {
  kind: SessionBannerKind;
  homeHref?: string;
}) {
  const t = useTranslations('live');
  const tj = useTranslations('join');
  const tc = useTranslations('common');

  const title = kind === 'ended' ? t('sessionEnded') : tj('sessionNotFound');

  return (
    <main className="container flex min-h-screen flex-col items-center justify-center py-16">
      <Card className="w-full max-w-md text-center">
        <CardHeader>
          <CardTitle className="text-2xl">{title}</CardTitle>
          {kind === 'notFound' && (
            <CardDescription>{tj('subtitle')}</CardDescription>
          )}
        </CardHeader>
        <CardContent className="flex justify-center gap-3">
          <Button asChild variant="outline">
            <Link href="/join">{tj('joinButton')}</Link>
          </Button>
          <Button asChild>
            <Link href={homeHref}>{tc('back')}</Link>
          </Button>
        </CardContent>
      </Card>
    </main>
  );
}
