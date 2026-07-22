import { setRequestLocale } from 'next-intl/server';
import { AppShell } from '@/components/app-shell';
import { TasksBoardView } from '@/components/tasks/tasks-board-view';

export default async function AdminTasksPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  return (
    <AppShell>
      <TasksBoardView />
    </AppShell>
  );
}
