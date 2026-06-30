import { setRequestLocale } from 'next-intl/server';
import { AppHeader } from '@/components/app-header';
import { MaterialsManager } from '@/components/materials/MaterialsManager';

export default async function TeacherMaterialsPage({
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
        <MaterialsManager />
      </main>
    </>
  );
}
