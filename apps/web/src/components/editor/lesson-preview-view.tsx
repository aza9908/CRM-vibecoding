'use client';

import { useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { ArrowLeft, Eye, Maximize2 } from 'lucide-react';
import { Link } from '@/i18n/routing';
import { useLesson } from '@/lib/api/hooks';
import type { Block } from '@/lib/api/types';
import { isInputBlock } from '@/lib/blocks';
import { WorkbookBlock } from '@/components/live/WorkbookBlock';
import { SlideDeck } from '@/components/live/SlideDeck';
import { Brand } from '@/components/brand';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { Badge } from '@/components/ui/badge';

/**
 * Teacher + student preview of the published workbook — same WorkbookBlock
 * rendering students see in live (answers stay local; optional demo focus).
 */
export function LessonPreviewView({ lessonId }: { lessonId: string }) {
  const t = useTranslations('editor');
  const tl = useTranslations('live');
  const tc = useTranslations('common');
  const { data: lesson, isLoading, isError } = useLesson(lessonId);
  const [demoFocus, setDemoFocus] = useState<string | null>(null);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [slideDeckOpen, setSlideDeckOpen] = useState(false);

  const blocks: Block[] = lesson?.blocks ?? [];
  const inputCount = useMemo(
    () => blocks.filter((b) => isInputBlock(b.type)).length,
    [blocks],
  );

  if (isLoading) {
    return (
      <main className="container flex items-center gap-2 py-8 text-muted-foreground">
        <Spinner />
        {tc('loading')}
      </main>
    );
  }

  if (isError || !lesson) {
    return (
      <main className="container py-8">
        <p className="text-destructive">{tc('error')}</p>
        <Button asChild variant="outline" className="mt-4">
          <Link href={`/editor/${lessonId}`}>{tc('back')}</Link>
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
                <Badge variant="secondary" className="gap-1">
                  <Eye className="h-3 w-3" />
                  {t('previewBadge')}
                </Badge>
                <span className="text-sm text-muted-foreground">
                  {t('previewHint')}
                </span>
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
            <Button asChild variant="outline" size="sm">
              <Link href={`/editor/${lessonId}`}>
                <ArrowLeft className="h-4 w-4" />
                {t('backToEditor')}
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
              onFocusClick={(id) => setDemoFocus(id)}
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
