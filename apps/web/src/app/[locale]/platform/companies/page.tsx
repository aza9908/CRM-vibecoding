import { setRequestLocale } from 'next-intl/server';
import { AppShell } from '@/components/app-shell';
import { PlatformCompaniesView } from '@/components/platform/platform-companies-view';

export default async function PlatformCompaniesPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  return (
    <AppShell>
      <PlatformCompaniesView />
    </AppShell>
  );
}
