'use client';

import { useDraggable } from '@dnd-kit/core';
import { CSS } from '@dnd-kit/utilities';
import { Clock } from 'lucide-react';
import type { TaskDto } from '@lms/shared';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

function isLate(task: TaskDto): boolean {
  if (!task.deadline || task.status === 'done') return false;
  return task.deadline < new Date().toISOString().slice(0, 10);
}

function formatDeadline(d: string): string {
  const [, month, day] = d.split('-');
  return `${day}.${month}`;
}

/** One draggable card on the Задачи board. Click opens the edit modal; drag
 * (past a 5px threshold, same sensor config as the block editor) moves it
 * between columns. */
export function TaskCard({
  task,
  onOpen,
}: {
  task: TaskDto;
  onOpen: (task: TaskDto) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, isDragging } =
    useDraggable({ id: task.id });

  const style = transform
    ? { transform: CSS.Translate.toString(transform) }
    : undefined;

  const late = isLate(task);

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...listeners}
      {...attributes}
      onClick={() => onOpen(task)}
      role="button"
      tabIndex={0}
      className={cn(
        'cursor-grab select-none rounded-lg border bg-card p-3 shadow-sm transition-shadow hover:shadow-md active:cursor-grabbing',
        isDragging && 'opacity-40',
      )}
    >
      <p className="text-sm font-medium leading-snug">{task.title}</p>
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        {task.assigneeName ? (
          <Badge variant="secondary">{task.assigneeName}</Badge>
        ) : null}
        {task.deadline ? (
          <Badge variant={late ? 'destructive' : 'outline'} className="gap-1">
            <Clock className="h-3 w-3" />
            {formatDeadline(task.deadline)}
          </Badge>
        ) : null}
      </div>
    </div>
  );
}
