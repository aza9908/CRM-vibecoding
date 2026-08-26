'use client';

import { useTranslations } from 'next-intl';
import { Users } from 'lucide-react';
import type { LiveParticipant, LiveResponses } from '@/lib/ws/useSessionSocket';
import type { Block } from '@/lib/api/types';
import { isInputBlock } from '@/lib/blocks';
import { studentColor } from '@/components/reports/charts';
import { cn } from '@/lib/utils';

function initial(name: string): string {
  return name.trim().charAt(0).toUpperCase() || '?';
}

function responseKey(participantId: string, blockId: string): string {
  return `${participantId}:${blockId}`;
}

function blockLabel(block: Block, index: number): string {
  if (block.type === 'test' && block.options && typeof block.options === 'object') {
    const q = (block.options as { question?: string }).question;
    if (q) return q.slice(0, 48);
  }
  if (block.content) {
    const first = block.content.split('\n')[0]?.trim() ?? '';
    if (first) return first.slice(0, 48);
  }
  return `#${index + 1}`;
}

/**
 * Teacher's live roster with per-student progress and last answered block
 * ("where they stopped").
 */
export function ParticipantsList({
  participants,
  blocks = [],
  responses = {},
  focusedBlockId = null,
}: {
  participants: LiveParticipant[];
  blocks?: Block[];
  responses?: LiveResponses;
  focusedBlockId?: string | null;
}) {
  const t = useTranslations('live');
  const interactive = blocks.filter((b) => isInputBlock(b.type));
  const total = interactive.length;

  function progressFor(participantId: string): number {
    if (total === 0) return 0;
    let done = 0;
    for (const b of interactive) {
      const r = responses[responseKey(participantId, b.id)];
      if (r?.answerText != null && String(r.answerText).trim() !== '') done += 1;
    }
    return Math.round((done / total) * 100);
  }

  function lastStop(participantId: string): string | null {
    let latest: { at: string; blockId: string } | null = null;
    for (const b of interactive) {
      const r = responses[responseKey(participantId, b.id)];
      if (!r?.answerText?.trim()) continue;
      if (!latest || r.at > latest.at) {
        latest = { at: r.at, blockId: b.id };
      }
    }
    if (!latest) return null;
    const idx = blocks.findIndex((b) => b.id === latest!.blockId);
    if (idx < 0) return null;
    return blockLabel(blocks[idx]!, idx);
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Users className="h-4 w-4 text-muted-foreground" />
        <h2 className="text-sm font-semibold">
          {t('participants')}{' '}
          <span className="text-muted-foreground">({participants.length})</span>
        </h2>
      </div>

      {participants.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('noParticipants')}</p>
      ) : (
        <ul className="space-y-2">
          {participants.map((p, i) => {
            const pct = progressFor(p.participantId);
            const stop = lastStop(p.participantId);
            const color = studentColor(i);
            return (
              <li
                key={p.participantId}
                className="rounded-lg border bg-card px-3 py-2"
              >
                <div className="flex items-center gap-2">
                  <span
                    className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold text-white"
                    style={{ backgroundColor: color }}
                  >
                    {initial(p.name)}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-sm font-medium">
                    {p.name}
                  </span>
                  <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                    {pct}%
                  </span>
                </div>
                <div
                  className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted"
                  role="progressbar"
                  aria-valuenow={pct}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-label={t('studentProgress', { name: p.name, percent: pct })}
                >
                  <div
                    className="h-full rounded-full transition-[width] duration-300"
                    style={{
                      width: `${pct}%`,
                      backgroundColor: pct > 0 ? color : 'transparent',
                    }}
                  />
                </div>
                {stop ? (
                  <p className="mt-1.5 truncate text-[11px] text-muted-foreground">
                    {t('stoppedAt', { block: stop })}
                  </p>
                ) : (
                  <p className="mt-1.5 text-[11px] text-muted-foreground">
                    {t('notStartedYet')}
                  </p>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {focusedBlockId ? (
        <p className="text-[11px] text-muted-foreground">
          {t('focusActiveHint')}
        </p>
      ) : null}
    </div>
  );
}
