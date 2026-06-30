'use client';

import * as React from 'react';
import type { LucideIcon } from 'lucide-react';
import { Card } from '@/components/ui/card';

/** A single KPI tile: label, large value, optional icon + hint. */
export function KpiCard({
  label,
  value,
  hint,
  icon: Icon,
}: {
  label: string;
  value: React.ReactNode;
  hint?: string;
  icon?: LucideIcon;
}) {
  return (
    <Card className="p-5">
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-medium text-muted-foreground">
          {label}
        </span>
        {Icon && <Icon className="h-4 w-4 text-muted-foreground" />}
      </div>
      <div className="mt-2 text-3xl font-bold tabular-nums tracking-tight">
        {value}
      </div>
      {hint && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
    </Card>
  );
}
