import { setRequestLocale } from 'next-intl/server';
import { AppShell } from '@/components/app-shell';
import { SyllabusView } from '@/components/lessons/syllabus-view';

export default async function SyllabusPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  return (
    <AppShell>
      <SyllabusView />
    </AppShell>
  );
}
