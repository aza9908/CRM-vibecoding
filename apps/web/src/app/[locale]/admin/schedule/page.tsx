import { setRequestLocale } from 'next-intl/server';
import { AppShell } from '@/components/app-shell';
import { ScheduleEditorView } from '@/components/schedule/schedule-editor-view';

export default async function AdminSchedulePage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  return (
    <AppShell>
      <ScheduleEditorView />
    </AppShell>
  );
}
