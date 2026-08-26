import { getTranslations, setRequestLocale } from 'next-intl/server';
import { AppShell } from '@/components/app-shell';
import { CurriculumTimeline } from '@/components/cabinet/curriculum-timeline';

export default async function SchedulePage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('nav');
  return (
    <AppShell>
      <main className="container py-8">
        <h1 className="mb-6 text-2xl font-semibold tracking-tight">
          {t('schedule')}
        </h1>
        <CurriculumTimeline />
      </main>
    </AppShell>
  );
}
