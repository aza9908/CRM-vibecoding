import { setRequestLocale } from 'next-intl/server';
import { AppHeader } from '@/components/app-header';
import { LessonsView } from '@/components/lessons/lessons-view';

export default async function TeacherLessonsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  return (
    <>
      <AppHeader />
      <main className="container py-8">
        <LessonsView />
      </main>
    </>
  );
}
