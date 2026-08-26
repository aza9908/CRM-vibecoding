'use client';

import * as React from 'react';
import { useTranslations } from 'next-intl';
import { Check, ChevronLeft, ChevronRight, X } from 'lucide-react';
import type { Block } from '@/lib/api/types';
import { isInputBlock } from '@/lib/blocks';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { WorkbookBlock } from './WorkbookBlock';

export interface SlideDeckProps {
  blocks: Block[];
  /** Slide to open on (e.g. the teacher's currently focused block). */
  initialBlockId?: string | null;
  /** Current answer per block (controlled, same shape as the scroll view). */
  answers: Record<string, string>;
  /** Block ids the student has explicitly marked complete. */
  completed: Set<string>;
  onAnswerChange?: (blockId: string, answerText: string) => void;
  onAnswerSubmit?: (blockId: string, answerText: string) => void;
  /**
   * Mark-complete checkmark handler. Omit for a read-only/preview deck (no
   * live session to persist against) — the checkmark is hidden in that case,
   * matching `WorkbookBlock`'s own `readOnly` convention.
   */
  onMarkComplete?: (blockId: string) => void;
  onFileUpload?: (blockId: string, file: File) => Promise<void>;
  onResolveFileUrl?: (blockId: string) => Promise<string>;
  readOnly?: boolean;
  onClose: () => void;
}

/**
 * Fullscreen, one-slide-at-a-time view over the same `WorkbookBlock`
 * renderer the continuous-scroll pages already use — wraps it, doesn't
 * reimplement block rendering. Additive: the scroll view stays the default,
 * this is an alternate mode the student opts into.
 */
export function SlideDeck({
  blocks,
  initialBlockId,
  answers,
  completed,
  onAnswerChange,
  onAnswerSubmit,
  onMarkComplete,
  onFileUpload,
  onResolveFileUrl,
  readOnly,
  onClose,
}: SlideDeckProps) {
  const t = useTranslations('live');
  const initialIndex = Math.max(
    0,
    blocks.findIndex((b) => b.id === initialBlockId),
  );
  const [index, setIndex] = React.useState(initialIndex);

  const total = blocks.length;
  const block = blocks[index];
  const isFirst = index === 0;
  const isLast = index === total - 1;

  const goPrev = React.useCallback(() => {
    setIndex((i) => Math.max(0, i - 1));
  }, []);
  const goNext = React.useCallback(() => {
    setIndex((i) => Math.min(total - 1, i + 1));
  }, [total]);

  React.useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
      else if (e.key === 'ArrowLeft') goPrev();
      else if (e.key === 'ArrowRight') goNext();
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose, goPrev, goNext]);

  if (!block) return null;

  const isDone = completed.has(block.id);

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-background">
      <header className="flex shrink-0 items-center justify-between gap-4 border-b px-4 py-3 sm:px-6">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-muted-foreground">
            {t('slideOf', { current: index + 1, total })}
          </span>
          {isDone ? (
            <span className="inline-flex items-center gap-1 rounded-full bg-success/15 px-2 py-0.5 text-xs font-medium text-success">
              <Check className="h-3 w-3" />
              {t('completed')}
            </span>
          ) : null}
        </div>
        <Button type="button" variant="ghost" size="icon" onClick={onClose} aria-label={t('exitFullscreen')}>
          <X />
        </Button>
      </header>

      <div className="flex flex-1 items-center justify-center overflow-y-auto px-4 py-6 sm:px-6">
        <div className="w-full max-w-2xl">
          <WorkbookBlock
            key={block.id}
            block={block}
            value={isInputBlock(block.type) ? answers[block.id] ?? '' : ''}
            readOnly={readOnly}
            onAnswerChange={onAnswerChange}
            onAnswerSubmit={onAnswerSubmit}
            onFileUpload={onFileUpload}
            onResolveFileUrl={onResolveFileUrl}
          />
        </div>
      </div>

      <footer className="flex shrink-0 items-center justify-between gap-3 border-t px-4 py-3 sm:px-6">
        <Button
          type="button"
          variant="outline"
          onClick={goPrev}
          disabled={isFirst}
        >
          <ChevronLeft className="h-4 w-4" />
          {t('prevSlide')}
        </Button>

        {onMarkComplete && !readOnly ? (
          <Button
            type="button"
            variant={isDone ? 'secondary' : 'default'}
            onClick={() => onMarkComplete(block.id)}
            className={cn(isDone && 'text-success')}
          >
            <Check className="h-4 w-4" />
            {isDone ? t('completed') : t('markComplete')}
          </Button>
        ) : (
          <span />
        )}

        <Button type="button" variant="outline" onClick={goNext} disabled={isLast}>
          {t('nextSlide')}
          <ChevronRight className="h-4 w-4" />
        </Button>
      </footer>
    </div>
  );
}
