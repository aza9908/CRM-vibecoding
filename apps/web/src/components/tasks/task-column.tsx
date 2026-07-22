'use client';

import type { ReactNode } from 'react';
import { useDroppable } from '@dnd-kit/core';
import type { TaskStatus } from '@lms/shared';
import { cn } from '@/lib/utils';

/** A drop target for one status column of the Задачи board. */
export function TaskColumn({
  status,
  label,
  count,
  children,
}: {
  status: TaskStatus;
  label: string;
  count: number;
  children: ReactNode;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: status });

  return (
    <div
      ref={setNodeRef}
      className={cn(
        'flex min-h-40 flex-col gap-2 rounded-xl border bg-muted/30 p-3 transition-colors',
        isOver && 'border-primary bg-primary/5',
      )}
    >
      <div className="flex items-center justify-between px-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        <span>{label}</span>
        <span>{count}</span>
      </div>
      <div className="flex flex-col gap-2">{children}</div>
    </div>
  );
}
