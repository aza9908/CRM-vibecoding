import { setRequestLocale } from 'next-intl/server';
import { AppShell } from '@/components/app-shell';
import { StudentMaterialsView } from '@/components/materials/student-materials-view';

export default async function StudentMaterialsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  return (
    <AppShell>
      <main className="container py-8">
        <StudentMaterialsView />
      </main>
    </AppShell>
  );
}
