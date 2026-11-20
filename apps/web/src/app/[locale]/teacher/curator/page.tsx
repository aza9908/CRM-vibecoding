import { setRequestLocale } from 'next-intl/server';
import { AppShell } from '@/components/app-shell';
import { CuratorView } from '@/components/ai-reports/curator-view';

export default async function TeacherCuratorPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  return (
    <AppShell>
      <main className="container py-8">
        <CuratorView />
      </main>
    </AppShell>
  );
}
