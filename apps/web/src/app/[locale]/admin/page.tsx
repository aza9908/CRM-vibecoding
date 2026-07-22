import { setRequestLocale } from 'next-intl/server';
import { AppShell } from '@/components/app-shell';
import { AdminUsersView } from '@/components/admin/admin-users-view';

export default async function AdminUsersPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  return (
    <AppShell>
      <AdminUsersView />
    </AppShell>
  );
}
