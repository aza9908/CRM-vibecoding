import { setRequestLocale, getTranslations } from 'next-intl/server';
import { AppShell } from '@/components/app-shell';
import { ServerRecordings } from '@/components/live/ServerRecordings';
import { RecordingFinder } from '@/components/live/RecordingFinder';

export default async function TeacherRecordingsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('videoRoom');
  return (
    <AppShell>
      <main className="container max-w-4xl py-8">
        <h1 className="mb-1 text-2xl font-semibold tracking-tight">{t('recPageTitle')}</h1>
        <p className="mb-6 text-sm text-muted-foreground">{t('recPageHint')}</p>
        <ServerRecordings className="block" />
        <RecordingFinder className="mt-6 block" />
      </main>
    </AppShell>
  );
}
