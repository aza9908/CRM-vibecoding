import { setRequestLocale } from 'next-intl/server';
import { AppShell } from '@/components/app-shell';
import { MaterialsManager } from '@/components/materials/MaterialsManager';

export default async function TeacherMaterialsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  return (
    <AppShell>
      <main className="container py-8">
        <MaterialsManager />
      </main>
    </AppShell>
  );
}
