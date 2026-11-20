import { setRequestLocale } from 'next-intl/server';
import { AppShell } from '@/components/app-shell';
import { LessonsView } from '@/components/lessons/lessons-view';
import { ServerRecordings } from '@/components/live/ServerRecordings';

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
        <ServerRecordings className="mb-6 block max-w-2xl" />
        <LessonsView />
      </main>
    </AppShell>
  );
}
