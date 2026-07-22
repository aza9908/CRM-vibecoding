'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import { Plus } from 'lucide-react';
import { taskStatusEnum, type TaskDto, type TaskStatus } from '@lms/shared';
import { useTasks, useTasksMeta, useUpdateTask } from '@/lib/api/hooks';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Spinner } from '@/components/ui/spinner';
import { TaskColumn } from './task-column';
import { TaskCard } from './task-card';
import { TaskEditDialog } from './task-edit-dialog';

const STATUS_LABEL_KEY: Record<TaskStatus, string> = {
  todo: 'columnTodo',
  doing: 'columnDoing',
  done: 'columnDone',
};

/**
 * Trello/Jira-style board for the org's internal Задачи — three columns
 * (Сделать / В работе / Готово), drag-and-drop between them, and a Telegram
 * post on every create/status-change/delete (best-effort, server-side).
 */
export function TasksBoardView() {
  const t = useTranslations('tasks');
  const tc = useTranslations('common');
  const { data, isLoading, isError } = useTasks();
  const { data: meta } = useTasksMeta();
  const updateTask = useUpdateTask();

  const [dialogTask, setDialogTask] = useState<TaskDto | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor),
  );

  function openCreate() {
    setDialogTask(null);
    setDialogOpen(true);
  }

  function openEdit(task: TaskDto) {
    setDialogTask(task);
    setDialogOpen(true);
  }

  function onDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over) return;

    const task = (data ?? []).find((t) => t.id === active.id);
    if (!task) return;

    const overId = String(over.id);
    const targetStatus: TaskStatus = (
      taskStatusEnum.options as readonly string[]
    ).includes(overId)
      ? (overId as TaskStatus)
      : ((data ?? []).find((t) => t.id === overId)?.status ?? task.status);

    if (targetStatus !== task.status) {
      updateTask.mutate({ id: task.id, dto: { status: targetStatus } });
    }
  }

  const tasks = data ?? [];

  return (
    <main className="container flex flex-col gap-6 py-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{t('title')}</h1>
          <p className="mt-1 text-muted-foreground">{t('subtitle')}</p>
          {meta ? (
            <Badge variant={meta.telegramConfigured ? 'success' : 'outline'} className="mt-2">
              {meta.telegramConfigured ? t('telegramOn') : t('telegramOff')}
            </Badge>
          ) : null}
        </div>
        <Button type="button" onClick={openCreate}>
          <Plus className="h-4 w-4" />
          {t('newTaskTitle')}
        </Button>
      </div>

      {isLoading ? (
        <div className="flex items-center gap-2 text-muted-foreground">
          <Spinner />
          {tc('loading')}
        </div>
      ) : isError ? (
        <p className="text-destructive">{tc('error')}</p>
      ) : (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={onDragEnd}
        >
          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            {taskStatusEnum.options.map((status) => {
              const inColumn = tasks.filter((tsk) => tsk.status === status);
              return (
                <TaskColumn
                  key={status}
                  status={status}
                  label={t(STATUS_LABEL_KEY[status])}
                  count={inColumn.length}
                >
                  {inColumn.length === 0 ? (
                    <p className="px-1 py-4 text-center text-xs text-muted-foreground">
                      {t('empty')}
                    </p>
                  ) : (
                    inColumn.map((task) => (
                      <TaskCard key={task.id} task={task} onOpen={openEdit} />
                    ))
                  )}
                </TaskColumn>
              );
            })}
          </div>
        </DndContext>
      )}

      <TaskEditDialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        task={dialogTask}
      />
    </main>
  );
}
