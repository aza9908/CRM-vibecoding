'use client';

import * as React from 'react';
import { useTranslations } from 'next-intl';
import { Focus } from 'lucide-react';
import type { LiveResponses, LiveParticipant } from '@/lib/ws/useSessionSocket';
import type { Block } from '@/lib/api/types';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';

export interface ResponsesSummaryProps {
  /** Latest live answers, keyed `${participantId}:${blockId}`. */
  responses: LiveResponses;
  participants: LiveParticipant[];
  blocks: Block[];
  /** The block the teacher is currently focusing (highlighted). */
  focusedBlockId: string | null;
  /** Clicking a block focuses it for everyone. */
  onFocusBlock: (blockId: string) => void;
}

function responseKey(participantId: string, blockId: string): string {
  return `${participantId}:${blockId}`;
}

/**
 * Teacher's live answer board: one column-ish card per input block, listing
 * each participant's latest answer. Clicking a block focuses it for students.
 */
export function ResponsesSummary({
  responses,
  participants,
  blocks,
  focusedBlockId,
  onFocusBlock,
}: ResponsesSummaryProps) {
  const t = useTranslations('live');

  const participantName = React.useCallback(
    (participantId: string) =>
      participants.find((p) => p.participantId === participantId)?.name ??
      participantId.slice(0, 8),
    [participants],
  );

  // Group the latest responses by block for quick lookup.
  const byBlock = React.useMemo(() => {
    const map = new Map<string, { participantId: string; answerText: string }[]>();
    for (const r of Object.values(responses)) {
      const list = map.get(r.blockId) ?? [];
      list.push({ participantId: r.participantId, answerText: r.answerText });
      map.set(r.blockId, list);
    }
    return map;
  }, [responses]);

  const totalResponses = Object.keys(responses).length;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold">{t('responses')}</h2>
        {totalResponses > 0 && (
          <span className="text-xs text-muted-foreground">{totalResponses}</span>
        )}
      </div>

      {totalResponses === 0 && (
        <p className="text-sm text-muted-foreground">{t('noResponses')}</p>
      )}

      <div className="space-y-3">
        {blocks.map((block, i) => {
          const answers = byBlock.get(block.id) ?? [];
          const focused = block.id === focusedBlockId;
          const label =
            block.content?.slice(0, 80) ||
            `${t('focusBlock')} ${i + 1}`;
          return (
            <div
              key={block.id}
              className={cn(
                'rounded-lg border p-3 transition-colors',
                focused
                  ? 'border-l-2 border-l-primary bg-primary/5'
                  : 'border-border bg-card',
              )}
            >
              <button
                type="button"
                onClick={() => onFocusBlock(block.id)}
                className="mb-2 flex w-full items-center justify-between gap-2 text-left"
              >
                <span className="line-clamp-1 text-sm font-medium">{label}</span>
                {focused ? (
                  <Badge className="shrink-0 gap-1">
                    <Focus className="h-3 w-3" />
                    {t('focused')}
                  </Badge>
                ) : (
                  <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground hover:bg-accent">
                    {t('focusBlock')}
                  </span>
                )}
              </button>

              {answers.length === 0 ? (
                <p className="text-xs text-muted-foreground">{t('noResponses')}</p>
              ) : (
                <ul className="space-y-1.5">
                  {answers.map((a) => (
                    <li
                      key={responseKey(a.participantId, block.id)}
                      className="flex flex-col rounded-md bg-muted/50 px-2.5 py-1.5 text-sm"
                    >
                      <span className="text-xs font-medium text-muted-foreground">
                        {participantName(a.participantId)}
                      </span>
                      <span className="whitespace-pre-wrap break-words text-foreground">
                        {a.answerText}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
