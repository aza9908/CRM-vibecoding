import type { Logger } from '@nestjs/common';
import type { AiReportLocale, AiReportStage } from '@lms/shared';

/** What a running agent gets from the job queue. */
export interface AgentContext {
  orgId: string;
  locale: AiReportLocale;
  signal: AbortSignal;
  logger: Logger;
  progress(progress: number, stage: AiReportStage): Promise<void>;
}

/** An agent either produces `{ report, stats }` or a machine-readable error. */
export type AgentOutcome<R, S> = { ok: true; report: R; stats: S } | { ok: false; error: string };

/** Who an anonymous label stands for (kept in our process, never sent out). */
export interface LabelTarget {
  name: string;
  participantId?: string;
}

/**
 * Resolve a label the model wrote back to the person: exact match first, then
 * tolerant of case / «№» / extra spaces ("участник №3" → «Участник 3»).
 */
export function labelResolver(
  targets: Map<string, LabelTarget>,
  word: string,
): (raw: unknown) => { label: string; target: LabelTarget } | null {
  return (raw) => {
    if (typeof raw !== 'string') return null;
    const exact = targets.get(raw.trim());
    if (exact) return { label: raw.trim(), target: exact };
    const m = /(\d{1,4})/.exec(raw);
    if (!m) return null;
    const label = `${word} ${Number(m[1])}`;
    const target = targets.get(label);
    return target ? { label, target } : null;
  };
}

/** First non-empty line of a block's markdown, without markup, cut to `max`. */
export function plainText(content: string | null | undefined, max: number): string {
  const text = (content ?? '')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[#*_`>|]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}
