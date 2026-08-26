import { setRequestLocale } from 'next-intl/server';
import { AppShell } from '@/components/app-shell';
import { StudentLessonsView } from '@/components/lessons/student-lessons-view';

export default async function StudentLessonsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  return (
    <AppShell>
      <main className="container py-8">
        <StudentLessonsView />
      </main>
    </AppShell>
  );
}
