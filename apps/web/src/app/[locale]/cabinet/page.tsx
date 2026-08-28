import { setRequestLocale } from 'next-intl/server';
import { AppShell } from '@/components/app-shell';
import { PersonalCabinetView } from '@/components/cabinet/personal-cabinet-view';

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
        <PersonalCabinetView />
      </main>
    </AppShell>
  );
}
