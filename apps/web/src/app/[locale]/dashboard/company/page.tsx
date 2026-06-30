import { setRequestLocale } from 'next-intl/server';
import { AppHeader } from '@/components/app-header';
import { CompanyDashboardView } from '@/components/reports/company-dashboard-view';

export default async function CompanyDashboardPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  return (
    <>
      <AppHeader />
      <main className="container py-8">
        <CompanyDashboardView />
      </main>
    </>
  );
}
