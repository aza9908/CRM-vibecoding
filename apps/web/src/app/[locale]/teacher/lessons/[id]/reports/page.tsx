import { setRequestLocale } from 'next-intl/server';
import { AppShell } from '@/components/app-shell';
import { ReportsListView } from '@/components/reports/reports-list-view';

export default async function LessonReportsPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale, id } = await params;
  setRequestLocale(locale);
  return (
    <AppShell>
      <main className="container py-8">
        <ReportsListView lessonId={id} />
      </main>
    </AppShell>
  );
}
