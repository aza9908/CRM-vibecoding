'use client';

import * as React from 'react';
import { useTranslations } from 'next-intl';
import { Eye, Paperclip } from 'lucide-react';
import type { LiveResponses, LiveParticipant } from '@/lib/ws/useSessionSocket';
import type { Block } from '@/lib/api/types';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { useResponseFileUrl } from '@/lib/api/hooks/use-live-rest';

/** Convention for `input_file` answers stored as plain text in `answerText`. */
const FILE_ANSWER_PREFIX = 'file:';

export interface ResponsesSummaryProps {
  responses: LiveResponses;
  participants: LiveParticipant[];
  blocks: Block[];
  focusedBlockId: string | null;
  onFocusBlock: (blockId: string) => void;
  /** Needed to resolve download URLs for `file:` answers (teacher view). */
  sessionId?: string;
}

/** A student's uploaded file/screenshot, shown as a download chip instead of
 * the raw `file:<key>` sentinel. */
function FileAnswerChip({
  sessionId,
  participantId,
  blockId,
}: {
  sessionId?: string;
  participantId: string;
  blockId: string;
}) {
  const t = useTranslations('live');
  const resolve = useResponseFileUrl(sessionId);

  async function open() {
    const { url } = await resolve.mutateAsync({ participantId, blockId });
    window.open(url, '_blank', 'noopener,noreferrer');
  }

  return (
    <Button
      type="button"
      size="sm"
      variant="outline"
      className="mt-0.5 h-7 gap-1.5"
      onClick={open}
      disabled={!sessionId || resolve.isPending}
    >
      {resolve.isPending ? <Spinner /> : <Paperclip className="h-3.5 w-3.5" />}
      {t('fileAttached')}
    </Button>
  );
}

function responseKey(participantId: string, blockId: string): string {
  return `${participantId}:${blockId}`;
}

function blockQuestion(block: Block, fallback: string): string {
  if (block.type === 'test' && block.options && typeof block.options === 'object') {
    const q = (block.options as { question?: string }).question;
    if (q?.trim()) return q.trim();
  }
  if (block.content?.trim()) {
    return block.content.trim().split('\n')[0] ?? fallback;
  }
  return fallback;
}

/**
 * Teacher live answer board — every input/test block with each student's
 * latest answer. Updated via WS + REST poll.
 */
export function ResponsesSummary({
  responses,
  participants,
  blocks,
  focusedBlockId,
  onFocusBlock,
  sessionId,
}: ResponsesSummaryProps) {
  const t = useTranslations('live');

  const participantName = React.useCallback(
    (participantId: string) =>
      participants.find((p) => p.participantId === participantId)?.name ??
      participantId.slice(0, 8),
    [participants],
  );

  const byBlock = React.useMemo(() => {
    const map = new Map<
      string,
      { participantId: string; answerText: string; at?: string }[]
    >();
    for (const r of Object.values(responses)) {
      if (!r.blockId) continue;
      const text = (r.answerText ?? '').trim();
      if (!text) continue;
      const list = map.get(r.blockId) ?? [];
      list.push({
        participantId: r.participantId,
        answerText: r.answerText,
        at: r.at,
      });
      map.set(r.blockId, list);
    }
    return map;
  }, [responses]);

  const totalResponses = React.useMemo(
    () =>
      Object.values(responses).filter((r) => (r.answerText ?? '').trim())
        .length,
    [responses],
  );

  if (blocks.length === 0) {
    return (
      <div className="space-y-2">
        <h2 className="text-sm font-semibold">{t('responses')}</h2>
        <p className="text-sm text-muted-foreground">{t('noResponses')}</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold">{t('responses')}</h2>
        <Badge variant="secondary" className="tabular-nums">
          {t('answersCount', { count: totalResponses })}
        </Badge>
      </div>

      {totalResponses === 0 && (
        <p className="text-sm text-muted-foreground">{t('waitingAnswers')}</p>
      )}

      <div className="space-y-3 pr-1">
        {blocks.map((block, i) => {
          const answers = byBlock.get(block.id) ?? [];
          const focused = block.id === focusedBlockId;
          const label = blockQuestion(block, `${t('focusBlock')} ${i + 1}`);
          return (
            <div
              key={block.id}
              className={cn(
                'rounded-lg border p-3 transition-colors',
                focused
                  ? 'border-primary bg-primary/5 ring-1 ring-primary/30'
                  : 'border-border bg-card',
              )}
            >
              <button
                type="button"
                onClick={() => onFocusBlock(block.id)}
                className="mb-2 flex w-full items-center justify-between gap-2 text-left"
              >
                <span className="line-clamp-2 text-sm font-semibold">
                  {i + 1}. {label}
                </span>
                <span className="flex shrink-0 items-center gap-1.5">
                  <Badge variant="outline" className="tabular-nums">
                    {answers.length}/{participants.length || '—'}
                  </Badge>
                  {focused ? (
                    <Badge className="gap-1">
                      <Eye className="h-3 w-3" />
                      {t('focused')}
                    </Badge>
                  ) : (
                    <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground hover:bg-accent">
                      {t('focusBlock')}
                    </span>
                  )}
                </span>
              </button>

              {answers.length === 0 ? (
                <p className="text-xs text-muted-foreground">{t('noResponses')}</p>
              ) : (
                <ul className="space-y-1.5">
                  {answers.map((a) => (
                    <li
                      key={responseKey(a.participantId, block.id)}
                      className="flex flex-col rounded-md border border-border/60 bg-background px-2.5 py-2 text-sm"
                    >
                      <span className="text-xs font-semibold text-primary">
                        {participantName(a.participantId)}
                      </span>
                      {a.answerText.startsWith(FILE_ANSWER_PREFIX) ? (
                        <FileAnswerChip
                          sessionId={sessionId}
                          participantId={a.participantId}
                          blockId={block.id}
                        />
                      ) : (
                        <span className="mt-0.5 whitespace-pre-wrap break-words text-foreground">
                          {a.answerText}
                        </span>
                      )}
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
