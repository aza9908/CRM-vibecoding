import { setRequestLocale } from 'next-intl/server';
import { AppShell } from '@/components/app-shell';
import { ReportDetailView } from '@/components/reports/report-detail-view';

export default async function SessionReportPage({
  params,
}: {
  params: Promise<{ locale: string; id: string; sessionId: string }>;
}) {
  const { locale, id, sessionId } = await params;
  setRequestLocale(locale);
  return (
    <AppShell>
      <main className="container py-8">
        <ReportDetailView lessonId={id} sessionId={sessionId} />
      </main>
    </AppShell>
  );
}
