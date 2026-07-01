import { setRequestLocale } from 'next-intl/server';
import { AppHeader } from '@/components/app-header';
import { CabinetView } from '@/components/cabinet/cabinet-view';

export default async function CabinetPage({
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
        <CabinetView />
      </main>
    </>
  );
}
