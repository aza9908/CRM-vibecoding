'use client';

import { useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useSearchParams } from 'next/navigation';
import { ArrowLeft, Eye, Maximize2 } from 'lucide-react';
import { Link } from '@/i18n/routing';
import { useLesson } from '@/lib/api/hooks';
import { ApiError } from '@/lib/api/client';
import type { Block } from '@/lib/api/types';
import { buildImageNavMap, isInputBlock } from '@/lib/blocks';
import { WorkbookBlock } from '@/components/live/WorkbookBlock';
import { SlideDeck } from '@/components/live/SlideDeck';
import { Brand } from '@/components/brand';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { Badge } from '@/components/ui/badge';

/**
 * Teacher preview of the published workbook, and — via the same route —
 * the read view for two different student entry points: "Прошлые уроки"
 * (`?from=past`) and the onboarding intro lesson (`?from=onboarding`).
 * `GET /lessons/:id` has no role restriction, so this already worked for a
 * student content-wise; only the chrome (badge, back link, teacher-only
 * demo-focus toggle) needs to match where the viewer actually came from.
 *
 * The caller states its origin explicitly via `?from=` rather than this
 * component inferring "is this a past lesson" from the viewer's role alone
 * — role is `student` for onboarding too, and inferring from role also
 * means every branch reads from the auth store, which is empty until the
 * persisted zustand store rehydrates client-side, flashing teacher chrome
 * for a beat. `from` is available synchronously from the URL instead.
 */
export function LessonPreviewView({ lessonId }: { lessonId: string }) {
  const t = useTranslations('editor');
  const tl = useTranslations('live');
  const tc = useTranslations('common');
  const searchParams = useSearchParams();
  const from = searchParams.get('from');
  const variant: 'teacher' | 'pastLesson' | 'onboarding' =
    from === 'onboarding' ? 'onboarding' : from === 'past' ? 'pastLesson' : 'teacher';
  const backHref =
    variant === 'onboarding'
      ? '/onboarding'
      : variant === 'pastLesson'
        ? '/lessons/past'
        : `/editor/${lessonId}`;
  const { data: lesson, isLoading, isError, error } = useLesson(lessonId);
  const [demoFocus, setDemoFocus] = useState<string | null>(null);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [slideDeckOpen, setSlideDeckOpen] = useState(false);

  const blocks: Block[] = lesson?.blocks ?? [];
  const inputCount = useMemo(
    () => blocks.filter((b) => isInputBlock(b.type)).length,
    [blocks],
  );
  const imageNavMap = useMemo(() => buildImageNavMap(blocks), [blocks]);

  if (isLoading) {
    return (
      <main className="container flex items-center gap-2 py-8 text-muted-foreground">
        <Spinner />
        {tc('loading')}
      </main>
    );
  }

  if (isError || !lesson) {
    // 404 here almost always means the lesson belongs to a different
    // organization than the one the logged-in account is signed into —
    // lessons are tenant-scoped, so switching to that company's account is
    // the fix, not a bug report.
    const status = error instanceof ApiError ? error.status : undefined;
    return (
      <main className="container py-8">
        <p className="text-destructive">{tc('error')}</p>
        {status === 404 && variant === 'teacher' ? (
          <p className="mt-1 text-sm text-muted-foreground">
            {t('previewErrorWrongOrg')}
          </p>
        ) : status && variant === 'teacher' ? (
          // Raw status/message is a teacher-debugging aid, not something to
          // surface verbatim to a student — `tc('error')` above already
          // gives them a plain, translated heading either way.
          <p className="mt-1 text-sm text-muted-foreground">
            {status}: {error instanceof ApiError ? error.message : ''}
          </p>
        ) : null}
        <Button asChild variant="outline" className="mt-4">
          <Link href={backHref}>{tc('back')}</Link>
        </Button>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-background">
      <header className="sticky top-0 z-20 border-b bg-background/95 backdrop-blur">
        <div className="container flex flex-wrap items-center justify-between gap-3 py-3">
          <div className="flex items-center gap-3">
            <Brand size="sm" />
            <div>
              <div className="flex items-center gap-2">
                {variant === 'onboarding' ? null : (
                  <Badge variant="secondary" className="gap-1">
                    <Eye className="h-3 w-3" />
                    {variant === 'pastLesson' ? t('pastLessonBadge') : t('previewBadge')}
                  </Badge>
                )}
                {variant === 'teacher' ? (
                  <span className="text-sm text-muted-foreground">
                    {t('previewHint')}
                  </span>
                ) : null}
              </div>
              <h1 className="text-lg font-semibold tracking-tight">
                {lesson.title}
              </h1>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {blocks.length > 0 ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setSlideDeckOpen(true)}
              >
                <Maximize2 className="h-4 w-4" />
                {tl('fullscreenMode')}
              </Button>
            ) : null}
            {variant === 'teacher' ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() =>
                  setDemoFocus((cur) =>
                    cur ? null : (blocks[0]?.id ?? null),
                  )
                }
              >
                {demoFocus ? t('previewClearFocus') : t('previewDemoFocus')}
              </Button>
            ) : null}
            <Button asChild variant="outline" size="sm">
              <Link href={backHref}>
                <ArrowLeft className="h-4 w-4" />
                {variant === 'teacher' ? t('backToEditor') : tc('back')}
              </Link>
            </Button>
          </div>
        </div>
      </header>

      <div className="container max-w-2xl space-y-4 py-8">
        <p className="text-sm text-muted-foreground">
          {t('previewMeta', {
            blocks: blocks.length,
            inputs: inputCount,
          })}
        </p>
        {blocks.length === 0 ? (
          <p className="text-sm text-muted-foreground">{tc('empty')}</p>
        ) : (
          blocks.map((block) => (
            <WorkbookBlock
              key={block.id}
              block={block}
              focused={block.id === demoFocus}
              value={isInputBlock(block.type) ? answers[block.id] ?? '' : ''}
              onAnswerChange={(id, text) =>
                setAnswers((prev) => ({ ...prev, [id]: text }))
              }
              imageNav={imageNavMap.get(block.id)}
              // Teacher-only demo tool — WorkbookBlock treats a block as
              // clickable/hoverable whenever this is set at all, so it must
              // stay entirely unset (not just gated by a hidden button) for
              // the student variants, or every block turns interactive with
              // no working "Show focus" control to explain why.
              onFocusClick={variant === 'teacher' ? (id) => setDemoFocus(id) : undefined}
            />
          ))
        )}
        {demoFocus ? (
          <p className="pt-2 text-center text-xs text-muted-foreground">
            {tl('focused')} — {t('previewFocusNote')}
          </p>
        ) : null}
      </div>

      {slideDeckOpen ? (
        <SlideDeck
          blocks={blocks}
          initialBlockId={demoFocus}
          answers={answers}
          completed={new Set()}
          onAnswerChange={(id, text) =>
            setAnswers((prev) => ({ ...prev, [id]: text }))
          }
          onClose={() => setSlideDeckOpen(false)}
        />
      ) : null}
    </main>
  );
}
