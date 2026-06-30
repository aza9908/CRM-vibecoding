'use client';

import * as React from 'react';
import { useTranslations } from 'next-intl';
import { Check } from 'lucide-react';
import type { Block } from '@/lib/api/types';
import { blockLabelKey } from '@/lib/blocks';
import { computeBlockStates, type BlockState } from '@/lib/progress';
import { cn } from '@/lib/utils';

export interface NavigationTabProps {
  blocks: Block[];
  /** Ids of blocks the student has answered (responses + local answers). */
  answered: Set<string>;
  /** Teacher's currently focused block (from useSessionSocket). */
  focusedBlockId: string | null;
  /** The block the student is currently working on (null = none). */
  activeBlockId?: string | null;
  /** Computed lesson percent over interactive blocks (0–100). */
  percent: number;
  /** Scroll the named block into view in the center stage. */
  onSelect: (blockId: string) => void;
}

/**
 * "Navigation" tab of the live workbook right panel (docs/08 §4).
 *
 * Lists every block with its progress status colour (green ✓ completed, blue
 * active, indigo-glow focused, neutral pending). Clicking a row scrolls to that
 * block in the center stage. A progress bar at the top reflects the lesson
 * completion percent over interactive blocks.
 */
export function NavigationTab({
  blocks,
  answered,
  focusedBlockId,
  activeBlockId = null,
  percent,
  onSelect,
}: NavigationTabProps) {
  const t = useTranslations('rightPanel');
  const te = useTranslations('editor');
  const tc = useTranslations('common');

  const states = React.useMemo(
    () => computeBlockStates(blocks, answered, activeBlockId, focusedBlockId),
    [blocks, answered, activeBlockId, focusedBlockId],
  );

  if (blocks.length === 0) {
    return (
      <p className="py-10 text-center text-sm text-muted-foreground">
        {tc('empty')}
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1.5">
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>{t('progress')}</span>
          <span className="font-medium text-foreground">{percent}%</span>
        </div>
        <div
          className="h-1.5 w-full overflow-hidden rounded-full bg-muted"
          role="progressbar"
          aria-valuenow={percent}
          aria-valuemin={0}
          aria-valuemax={100}
        >
          <div
            className="h-full rounded-full bg-primary transition-all"
            style={{ width: `${percent}%` }}
          />
        </div>
      </div>

      <ol className="flex flex-col gap-1">
        {blocks.map((block, i) => {
          const state = states.get(block.id) ?? 'pending';
          return (
            <li key={block.id}>
              <button
                type="button"
                onClick={() => onSelect(block.id)}
                aria-current={state === 'focused' ? 'true' : undefined}
                className={cn(
                  'flex w-full items-center gap-2.5 rounded-md border px-3 py-2 text-left text-sm transition-colors',
                  stateClasses(state),
                )}
              >
                <StatusDot state={state} index={i + 1} />
                <span className="min-w-0 flex-1 truncate">
                  {block.content?.trim()
                    ? block.content
                    : te(blockLabelKey(block.type))}
                </span>
              </button>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

/** Per-state container styling (border/background/text). */
function stateClasses(state: BlockState): string {
  switch (state) {
    case 'focused':
      // Indigo "glow" — the teacher is focusing this block.
      return 'border-primary bg-primary/10 text-foreground shadow-[0_0_0_3px_hsl(var(--primary)/0.15)]';
    case 'active':
      return 'border-blue-500/60 bg-blue-500/10 text-foreground';
    case 'completed':
      return 'border-emerald-500/40 bg-emerald-500/5 text-foreground hover:bg-emerald-500/10';
    case 'pending':
    default:
      return 'border-border bg-card text-muted-foreground hover:bg-accent';
  }
}

/** Leading indicator: a check for completed, otherwise the 1-based position. */
function StatusDot({ state, index }: { state: BlockState; index: number }) {
  const base =
    'flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold';
  if (state === 'completed') {
    return (
      <span className={cn(base, 'bg-emerald-500 text-white')}>
        <Check className="h-3 w-3" />
      </span>
    );
  }
  if (state === 'focused') {
    return <span className={cn(base, 'bg-primary text-primary-foreground')}>{index}</span>;
  }
  if (state === 'active') {
    return <span className={cn(base, 'bg-blue-500 text-white')}>{index}</span>;
  }
  return (
    <span className={cn(base, 'border border-input bg-background text-muted-foreground')}>
      {index}
    </span>
  );
}
