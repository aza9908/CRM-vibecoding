import { setRequestLocale } from 'next-intl/server';
import { AppShell } from '@/components/app-shell';
import { RatingPageView } from '@/components/rating/rating-page-view';

export default async function RatingPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  return (
    <AppShell>
      <main className="container py-8">
        <RatingPageView />
      </main>
    </AppShell>
  );
}
