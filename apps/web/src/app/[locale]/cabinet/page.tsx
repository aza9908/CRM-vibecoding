import { setRequestLocale } from 'next-intl/server';
import { AppShell } from '@/components/app-shell';
import { CabinetView } from '@/components/cabinet/cabinet-view';

export default async function CabinetPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  return (
    <AppShell>
      <main className="container py-8">
        <CabinetView />
      </main>
    </AppShell>
  );
}
