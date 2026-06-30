import { setRequestLocale } from 'next-intl/server';
import { AppHeader } from '@/components/app-header';
import { EditorView } from '@/components/editor/editor-view';

export default async function EditorPage({
  params,
}: {
  params: Promise<{ locale: string; lessonId: string }>;
}) {
  const { locale, lessonId } = await params;
  setRequestLocale(locale);
  return (
    <>
      <AppHeader />
      <EditorView lessonId={lessonId} />
    </>
  );
}
