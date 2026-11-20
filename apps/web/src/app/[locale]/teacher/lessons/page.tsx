import { setRequestLocale } from 'next-intl/server';
import { AppShell } from '@/components/app-shell';
import { LessonsView } from '@/components/lessons/lessons-view';
import { ServerRecordings } from '@/components/live/ServerRecordings';
import { RecordingFinder } from '@/components/live/RecordingFinder';

export default async function TeacherLessonsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  return (
    <AppShell>
      <main className="container py-8">
        <LessonsView />
        <ServerRecordings className="mt-10 block max-w-2xl" />
        <RecordingFinder className="mt-4 block max-w-2xl" />
      </main>
    </AppShell>
  );
}
