import { setRequestLocale } from 'next-intl/server';
import { AppShell } from '@/components/app-shell';
import { ToolsView } from '@/components/tools/tools-view';

export default async function ToolsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  return (
    <AppShell>
      <main className="container py-8">
        <ToolsView />
      </main>
    </AppShell>
  );
}
