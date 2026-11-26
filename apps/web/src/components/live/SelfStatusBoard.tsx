'use client';

import * as React from 'react';
import { useTranslations } from 'next-intl';
import type { Block } from '@/lib/api/types';
import { cn } from '@/lib/utils';
import { RichBlockText } from './RichBlockText';
import { BoardContext } from './board-context';

/** One field of a self-reported status row. */
interface SelfField {
  key: string;
  title: string;
  kind?: 'text' | 'choice';
  placeholder?: string;
  choices?: { value: string; label: string; tone?: 'ok' | 'warn' | 'bad' | 'muted' }[];
}

interface SelfOptions {
  self?: boolean;
  fields?: SelfField[];
  /** Field that heads the row in the teacher's table (e.g. department). */
  rowField?: string;
  /** Field whose choices are counted in the summary (e.g. status). */
  summaryField?: string;
}

export function isSelfStatusBoard(block: Block): boolean {
  return block.type === 'status_board' && (block.options as SelfOptions | null)?.self === true;
}

function parse(value: string | undefined): Record<string, string> {
  if (!value) return {};
  try {
    const v = JSON.parse(value) as unknown;
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      const out: Record<string, string> = {};
      for (const [k, x] of Object.entries(v as Record<string, unknown>)) if (typeof x === 'string') out[k] = x;
      return out;
    }
  } catch {
    /* not ours */
  }
  return {};
}

const TONE: Record<string, string> = {
  ok: 'bg-emerald-100 text-emerald-800 border-emerald-300 dark:bg-emerald-900/40 dark:text-emerald-200',
  warn: 'bg-amber-100 text-amber-900 border-amber-300 dark:bg-amber-900/40 dark:text-amber-200',
  bad: 'bg-rose-100 text-rose-800 border-rose-300 dark:bg-rose-900/40 dark:text-rose-200',
  muted: 'bg-muted text-muted-foreground border-border',
};

/**
 * «Статус проекта», filled in by every participant for themselves. The
 * student page shows a form for the participant's own row (saved like any
 * answer, so it reaches the teacher at once); the teacher page shows the
 * whole table, updating live, with a summary of statuses.
 */
export function SelfStatusBoard({
  block,
  value,
  readOnly,
  onChange,
}: {
  block: Block;
  value?: string;
  readOnly?: boolean;
  onChange?: (blockId: string, answerText: string) => void;
}) {
  const t = useTranslations('live');
  const ctx = React.useContext(BoardContext);
  const o = (block.options ?? {}) as SelfOptions;
  const fields = o.fields ?? [];
  const teacher = !!ctx.people && !!ctx.answerOf;

  const header = block.content ? (
    <div className="text-sm">
      <RichBlockText text={block.content} asLabel />
    </div>
  ) : null;

  if (teacher) {
    const rows = ctx.people!.map((p) => ({ ...p, data: parse(ctx.answerOf!(p.participantId, block.id)) }));
    const rowField = o.rowField;
    rows.sort((a, b) => {
      const fa = Object.keys(a.data).length ? 0 : 1;
      const fb = Object.keys(b.data).length ? 0 : 1;
      return fa - fb || (a.data[rowField ?? ''] ?? '').localeCompare(b.data[rowField ?? ''] ?? '') || a.name.localeCompare(b.name);
    });
    const filled = rows.filter((r) => Object.keys(r.data).length > 0).length;
    const sumField = fields.find((f) => f.key === o.summaryField);
    const labelOf = (f: SelfField, v: string | undefined) => f.choices?.find((c) => c.value === v)?.label ?? v ?? '';
    return (
      <div className="space-y-3" data-self-status>
        {header}
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className="text-muted-foreground">{t('selfFilled', { filled, total: rows.length })}</span>
          {sumField?.choices?.map((c) => {
            const n = rows.filter((r) => r.data[sumField.key] === c.value).length;
            return (
              <span key={c.value} className={cn('rounded-full border px-2 py-0.5 font-medium', TONE[c.tone ?? 'muted'])}>
                {c.label}: {n}
              </span>
            );
          })}
        </div>
        <div className="-mx-1 overflow-x-auto px-1">
          <table className="w-full min-w-[640px] border-separate border-spacing-0 text-sm">
            <thead>
              <tr className="text-left text-xs text-muted-foreground">
                <th className="border-b px-2 py-2 font-medium">{t('selfParticipant')}</th>
                {fields.map((f) => (
                  <th key={f.key} className="border-b px-2 py-2 font-medium">{f.title}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.participantId} className={Object.keys(r.data).length ? '' : 'opacity-60'}>
                  <td className="border-b px-2 py-2 font-medium">{r.name}</td>
                  {fields.map((f) => {
                    const v = r.data[f.key];
                    const choice = f.choices?.find((c) => c.value === v);
                    return (
                      <td key={f.key} className="max-w-[16rem] border-b px-2 py-2 align-top">
                        {!v ? (
                          <span className="text-muted-foreground">—</span>
                        ) : choice ? (
                          <span className={cn('inline-block rounded-full border px-2 py-0.5 text-xs font-medium', TONE[choice.tone ?? 'muted'])}>
                            {labelOf(f, v)}
                          </span>
                        ) : (
                          <span className="break-words">{v}</span>
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={fields.length + 1} className="px-2 py-6 text-center text-muted-foreground">
                    {t('selfNobody')}
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </div>
    );
  }

  // Participant: their own row.
  const data = parse(value);
  const set = (key: string, v: string) => {
    if (readOnly || !onChange) return;
    const next = { ...data, [key]: v };
    if (!v) delete next[key];
    onChange(block.id, Object.keys(next).length ? JSON.stringify(next) : '');
  };
  return (
    <div className="space-y-4" data-self-status>
      {header}
      <p className="text-xs text-muted-foreground">{t('selfHint')}</p>
      <div className="grid gap-4 sm:grid-cols-2">
        {fields.map((f) => (
          <div key={f.key} className={cn('space-y-1.5', (f.kind ?? 'text') === 'text' && f.choices == null && 'sm:col-span-2')}>
            <p className="text-sm font-medium">{f.title}</p>
            {f.choices?.length ? (
              <div className="flex flex-wrap gap-2" role="radiogroup" aria-label={f.title}>
                {f.choices.map((c) => {
                  const on = data[f.key] === c.value;
                  return (
                    <button
                      key={c.value}
                      type="button"
                      role="radio"
                      aria-checked={on}
                      disabled={readOnly}
                      onClick={() => set(f.key, on ? '' : c.value)}
                      className={cn(
                        'rounded-full border px-3 py-1.5 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60',
                        on ? cn('font-semibold ring-2 ring-primary/40', TONE[c.tone ?? 'muted']) : 'bg-background hover:bg-accent',
                      )}
                    >
                      {c.label}
                    </button>
                  );
                })}
              </div>
            ) : (
              <input
                type="text"
                defaultValue={data[f.key] ?? ''}
                disabled={readOnly}
                maxLength={300}
                placeholder={f.placeholder}
                onChange={(e) => set(f.key, e.target.value.trim())}
                className="h-10 w-full rounded-md border bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"
              />
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
