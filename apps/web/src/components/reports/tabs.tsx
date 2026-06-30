'use client';

import * as React from 'react';
import { cn } from '@/lib/utils';

export interface TabItem {
  value: string;
  label: string;
}

/**
 * Minimal underlined tab bar (no extra dependency). Controlled by the parent so
 * report pages can keep the active tab in their own state. Styled to match the
 * Lumen indigo accent used elsewhere.
 */
export function Tabs({
  items,
  value,
  onChange,
}: {
  items: TabItem[];
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <div
      role="tablist"
      className="flex flex-wrap gap-1 border-b border-border"
    >
      {items.map((item) => {
        const active = item.value === value;
        return (
          <button
            key={item.value}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(item.value)}
            className={cn(
              '-mb-px border-b-2 px-4 py-2.5 text-sm font-medium transition-colors',
              active
                ? 'border-primary text-foreground'
                : 'border-transparent text-muted-foreground hover:text-foreground',
            )}
          >
            {item.label}
          </button>
        );
      })}
    </div>
  );
}
