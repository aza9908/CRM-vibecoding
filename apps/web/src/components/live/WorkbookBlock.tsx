'use client';

import * as React from 'react';
import { useTranslations } from 'next-intl';
import { Focus } from 'lucide-react';
import type { Block } from '@/lib/api/types';
import { cn } from '@/lib/utils';
import { isInputBlock } from '@/lib/blocks';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';

/** A single option for select-style blocks. */
interface SelectOption {
  id?: string;
  value?: string;
  label?: string;
}

/** Best-effort parse of a block's `options` JSON into a list of labels/values. */
function parseSelectOptions(options: unknown): SelectOption[] {
  if (!options) return [];
  if (Array.isArray(options)) {
    return options.map((o) => {
      if (typeof o === 'string') return { value: o, label: o };
      if (o && typeof o === 'object') {
        const obj = o as Record<string, unknown>;
        const label =
          (typeof obj.label === 'string' && obj.label) ||
          (typeof obj.text === 'string' && obj.text) ||
          (typeof obj.value === 'string' && obj.value) ||
          '';
        const value =
          (typeof obj.value === 'string' && obj.value) ||
          (typeof obj.id === 'string' && obj.id) ||
          label;
        return { id: typeof obj.id === 'string' ? obj.id : undefined, value, label };
      }
      return { value: String(o), label: String(o) };
    });
  }
  if (typeof options === 'object') {
    const obj = options as Record<string, unknown>;
    const choices = obj.options ?? obj.choices ?? obj.items;
    if (Array.isArray(choices)) return parseSelectOptions(choices);
  }
  return [];
}

export interface WorkbookBlockProps {
  block: Block;
  /** Whether this block is the one the teacher is currently focusing. */
  focused?: boolean;
  /** Read-only mode (teacher preview): inputs are disabled, no answers sent. */
  readOnly?: boolean;
  /** Current student answer for this block (controlled). */
  value?: string;
  /** Called whenever the student edits their answer. Debouncing is upstream. */
  onAnswerChange?: (blockId: string, answerText: string) => void;
  /** Teacher mode: clicking the block focuses it for everyone. */
  onFocusClick?: (blockId: string) => void;
}

/**
 * Renders one workbook block by type. Presentational blocks (text/image)
 * render their content; input blocks render an answer control wired to
 * `onAnswerChange`. The focused block gets a highlighted ring + scroll anchor.
 */
export const WorkbookBlock = React.forwardRef<HTMLDivElement, WorkbookBlockProps>(
  function WorkbookBlock(
    { block, focused, readOnly, value, onAnswerChange, onFocusClick },
    ref,
  ) {
    const t = useTranslations('live');
    const answerable = isInputBlock(block.type);

    const emit = React.useCallback(
      (next: string) => {
        if (readOnly) return;
        onAnswerChange?.(block.id, next);
      },
      [block.id, onAnswerChange, readOnly],
    );

    const interactive = !!onFocusClick;

    return (
      <div
        ref={ref}
        id={`block-${block.id}`}
        onClick={interactive ? () => onFocusClick?.(block.id) : undefined}
        className={cn(
          'scroll-mt-24 rounded-lg border bg-card p-4 transition-all',
          focused
            ? 'border-l-2 border-l-primary bg-primary/5 shadow-sm'
            : 'border-border',
          interactive && 'cursor-pointer hover:border-primary/60',
        )}
      >
        {focused && (
          <div className="mb-2 inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium uppercase tracking-wide text-primary">
            <Focus className="h-3 w-3" />
            {t('focused')}
          </div>
        )}

        <BlockBody
          block={block}
          options={parseSelectOptions(block.options)}
          answerable={answerable}
          readOnly={readOnly}
          value={value ?? ''}
          onChange={emit}
        />
      </div>
    );
  },
);

interface BlockBodyProps {
  block: Block;
  options: SelectOption[];
  answerable: boolean;
  readOnly?: boolean;
  value: string;
  onChange: (next: string) => void;
}

function BlockBody({
  block,
  options,
  answerable,
  readOnly,
  value,
  onChange,
}: BlockBodyProps) {
  const t = useTranslations('live');

  switch (block.type) {
    case 'text':
      return (
        <p className="whitespace-pre-wrap text-sm leading-relaxed text-foreground">
          {block.content}
        </p>
      );

    case 'image':
      return block.imageUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={block.imageUrl}
          alt={block.content ?? ''}
          className="max-h-96 w-full rounded-md object-contain"
        />
      ) : (
        <p className="text-sm text-muted-foreground">{block.content}</p>
      );

    case 'action_button': {
      // The editor stores the button label/href in options (not content).
      const rec =
        block.options && typeof block.options === 'object'
          ? (block.options as Record<string, unknown>)
          : {};
      const label =
        (typeof rec.label === 'string' && rec.label) ||
        block.content ||
        t('focusBlock');
      const href = typeof rec.href === 'string' ? rec.href : '';
      return href ? (
        <Button asChild variant="secondary">
          <a href={href} target="_blank" rel="noreferrer">
            {label}
          </a>
        </Button>
      ) : (
        <Button type="button" variant="secondary" disabled={readOnly}>
          {label}
        </Button>
      );
    }

    case 'input_text':
      return (
        <div className="space-y-2">
          {block.content && (
            <Label className="text-sm font-medium">{block.content}</Label>
          )}
          <Textarea
            value={value}
            disabled={readOnly}
            placeholder={t('answerPlaceholder')}
            onChange={(e) => onChange(e.target.value)}
            className="min-h-[96px]"
          />
        </div>
      );

    case 'input_rating':
      return (
        <div className="space-y-2">
          {block.content && (
            <Label className="text-sm font-medium">{block.content}</Label>
          )}
          <div className="flex gap-1">
            {[1, 2, 3, 4, 5].map((n) => {
              const selected = value === String(n);
              return (
                <button
                  key={n}
                  type="button"
                  disabled={readOnly}
                  onClick={() => onChange(String(n))}
                  className={cn(
                    'h-9 w-9 rounded-md border text-sm font-medium transition-colors disabled:opacity-50',
                    selected
                      ? 'border-primary bg-primary text-primary-foreground'
                      : 'border-input bg-background hover:bg-accent',
                  )}
                >
                  {n}
                </button>
              );
            })}
          </div>
        </div>
      );

    case 'input_select':
    case 'test': {
      // A test/quiz answers by picking one of its options (same UI as a select);
      // a test with no options falls back to a free-text answer. The test's
      // question lives in options.question, while a select keeps it in content.
      const optsRec =
        block.options && typeof block.options === 'object'
          ? (block.options as Record<string, unknown>)
          : {};
      const heading =
        block.type === 'test' &&
        typeof optsRec.question === 'string' &&
        optsRec.question
          ? optsRec.question
          : block.content;

      if (block.type === 'test' && options.length === 0) {
        return (
          <div className="space-y-2">
            {heading && (
              <Label className="text-sm font-medium">{heading}</Label>
            )}
            <Textarea
              value={value}
              disabled={readOnly}
              placeholder={t('answerPlaceholder')}
              onChange={(e) => onChange(e.target.value)}
              className="min-h-[96px]"
            />
          </div>
        );
      }
      return (
        <div className="space-y-2">
          {heading && (
            <Label className="text-sm font-medium">{heading}</Label>
          )}
          <div className="flex flex-col gap-2">
            {options.length === 0 && (
              <p className="text-sm text-muted-foreground">{t('empty')}</p>
            )}
            {options.map((opt, i) => {
              const optValue = opt.value ?? opt.label ?? String(i);
              const selected = value === optValue;
              return (
                <button
                  key={opt.id ?? optValue ?? i}
                  type="button"
                  disabled={readOnly}
                  onClick={() => onChange(optValue)}
                  className={cn(
                    'flex items-center gap-2 rounded-md border px-3 py-2 text-left text-sm transition-colors disabled:opacity-50',
                    selected
                      ? 'border-primary bg-primary/10'
                      : 'border-input bg-background hover:bg-accent',
                  )}
                >
                  <span
                    className={cn(
                      'h-4 w-4 shrink-0 rounded-full border',
                      selected ? 'border-primary bg-primary' : 'border-input',
                    )}
                  />
                  {opt.label ?? optValue}
                </button>
              );
            })}
          </div>
        </div>
      );
    }

    case 'input_file':
      return (
        <div className="space-y-2">
          {block.content && (
            <Label className="text-sm font-medium">{block.content}</Label>
          )}
          <Input
            type="text"
            value={value}
            disabled={readOnly}
            placeholder={t('answerPlaceholder')}
            onChange={(e) => onChange(e.target.value)}
          />
        </div>
      );

    default:
      return answerable ? (
        <Textarea
          value={value}
          disabled={readOnly}
          placeholder={t('answerPlaceholder')}
          onChange={(e) => onChange(e.target.value)}
        />
      ) : (
        <p className="whitespace-pre-wrap text-sm text-foreground">
          {block.content}
        </p>
      );
  }
}
