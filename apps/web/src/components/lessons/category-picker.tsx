'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Check, Tag, X } from 'lucide-react';
import { LESSON_CATEGORY_MAX } from '@lms/shared';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { cn } from '@/lib/utils';

/** Radix Select can't hold '' as an item value. */
const NONE = '__none__';
const NEW = '__new__';

/**
 * Pick the group a lesson is filed under: one of the known categories, a new
 * one typed in place, or none.
 */
export function CategoryPicker({
  id,
  value,
  options,
  onChange,
  disabled,
  compact,
  className,
}: {
  id?: string;
  value: string | null;
  /** Known categories (presets + ones already used in this org). */
  options: string[];
  onChange: (next: string | null) => void;
  disabled?: boolean;
  /** Borderless inline trigger for lesson cards. */
  compact?: boolean;
  className?: string;
}) {
  const t = useTranslations('lessons');
  const tc = useTranslations('common');
  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState('');

  const all = value && !options.includes(value) ? [...options, value] : options;

  function commit() {
    const next = draft.trim().replace(/\s+/g, ' ');
    setCreating(false);
    setDraft('');
    if (next && next !== value) onChange(next);
  }

  if (creating) {
    return (
      <div className={cn('flex items-center gap-1.5', className)}>
        <Input
          id={id}
          value={draft}
          maxLength={LESSON_CATEGORY_MAX}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              commit();
            }
            if (e.key === 'Escape') {
              e.stopPropagation();
              setCreating(false);
              setDraft('');
            }
          }}
          placeholder={t('categoryNewPlaceholder')}
          aria-label={t('categoryNew')}
          autoFocus
          className="h-9"
        />
        <Button
          type="button"
          size="icon"
          variant="ghost"
          className="h-9 w-9 shrink-0"
          onClick={commit}
          aria-label={tc('save')}
        >
          <Check />
        </Button>
        <Button
          type="button"
          size="icon"
          variant="ghost"
          className="h-9 w-9 shrink-0"
          onClick={() => {
            setCreating(false);
            setDraft('');
          }}
          aria-label={tc('cancel')}
        >
          <X />
        </Button>
      </div>
    );
  }

  return (
    <Select
      value={value ?? NONE}
      disabled={disabled}
      onValueChange={(v) => {
        if (v === NEW) {
          setCreating(true);
          return;
        }
        onChange(v === NONE ? null : v);
      }}
    >
      <SelectTrigger
        id={id}
        aria-label={t('category')}
        className={cn(
          // SelectTrigger clamps its span with -webkit-box, which would stack
          // the icon above the label.
          '[&>span]:!flex',
          compact &&
            'h-8 w-auto max-w-full gap-1.5 rounded-full border-dashed px-2.5 py-0 text-xs font-medium text-muted-foreground hover:border-primary/50 hover:text-foreground',
          className,
        )}
      >
        <span className="flex min-w-0 items-center gap-1.5">
          <Tag className="h-3.5 w-3.5 shrink-0" aria-hidden />
          <span className="truncate">
            <SelectValue />
          </span>
        </span>
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={NONE}>{t('categoryNone')}</SelectItem>
        {all.map((c) => (
          <SelectItem key={c} value={c}>
            {c}
          </SelectItem>
        ))}
        <SelectItem value={NEW}>{t('categoryNew')}</SelectItem>
      </SelectContent>
    </Select>
  );
}
