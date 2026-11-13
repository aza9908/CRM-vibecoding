import { setRequestLocale } from 'next-intl/server';
import { AppShell } from '@/components/app-shell';
import { ReportsListView } from '@/components/reports/reports-list-view';
import { LessonAnalysesList } from '@/components/analysis/LessonAnalysisCard';

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
        {/* AI reviews of this lesson's recorded sessions (hidden when none). */}
        <LessonAnalysesList lessonId={id} className="mt-10" />
      </main>
    </AppShell>
  );
}
