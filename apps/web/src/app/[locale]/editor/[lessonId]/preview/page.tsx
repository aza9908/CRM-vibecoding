import { setRequestLocale } from 'next-intl/server';
import { LessonPreviewView } from '@/components/editor/lesson-preview-view';

export default async function LessonPreviewPage({
  params,
}: {
  params: Promise<{ locale: string; lessonId: string }>;
}) {
  const { locale, lessonId } = await params;
  setRequestLocale(locale);
  return <LessonPreviewView lessonId={lessonId} />;
}
