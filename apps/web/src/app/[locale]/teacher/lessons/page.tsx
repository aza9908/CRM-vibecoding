import { setRequestLocale } from 'next-intl/server';
import { AppShell } from '@/components/app-shell';
import { LessonsView } from '@/components/lessons/lessons-view';

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
      </main>
    </AppShell>
  );
}
