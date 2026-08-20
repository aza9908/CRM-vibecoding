import { setRequestLocale } from 'next-intl/server';
import { AppShell } from '@/components/app-shell';
import { AdminCompanyView } from '@/components/admin/admin-company-view';

export default async function AdminCompanyPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  return (
    <AppShell>
      <AdminCompanyView />
    </AppShell>
  );
}
