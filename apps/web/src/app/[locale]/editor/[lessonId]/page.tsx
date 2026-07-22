import { setRequestLocale } from 'next-intl/server';
import { AppShell } from '@/components/app-shell';
import { EditorView } from '@/components/editor/editor-view';

export default async function EditorPage({
  params,
}: {
  params: Promise<{ locale: string; lessonId: string }>;
}) {
  const { locale, lessonId } = await params;
  setRequestLocale(locale);
  return (
    <AppShell>
      <EditorView lessonId={lessonId} />
    </AppShell>
  );
}
