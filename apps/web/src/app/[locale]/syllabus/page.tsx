import { setRequestLocale } from 'next-intl/server';
import { AppHeader } from '@/components/app-header';
import { SyllabusView } from '@/components/lessons/syllabus-view';

export default async function SyllabusPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  return (
    <>
      <AppHeader />
      <SyllabusView />
    </>
  );
}
