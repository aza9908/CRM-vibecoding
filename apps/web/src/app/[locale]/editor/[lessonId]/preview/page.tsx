import { Suspense } from 'react';
import { setRequestLocale } from 'next-intl/server';
import { LessonPreviewView } from '@/components/editor/lesson-preview-view';
import { Spinner } from '@/components/ui/spinner';

/**
 * `LessonPreviewView` reads `?from=` via `useSearchParams`, which forces a
 * client boundary — the Suspense wrapper keeps the route statically
 * renderable (same pattern as the reset-password page).
 */
export default async function LessonPreviewPage({
  params,
}: {
  params: Promise<{ locale: string; lessonId: string }>;
}) {
  const { locale, lessonId } = await params;
  setRequestLocale(locale);
  return (
    <Suspense
      fallback={
        <main className="container flex items-center py-8">
          <Spinner />
        </main>
      }
    >
      <LessonPreviewView lessonId={lessonId} />
    </Suspense>
  );
}
