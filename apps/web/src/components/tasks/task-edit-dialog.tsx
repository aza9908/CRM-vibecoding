'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { useTranslations } from 'next-intl';
import { Trash2 } from 'lucide-react';
import {
  taskStatusEnum,
  type TaskDto,
  type TaskStatus,
} from '@lms/shared';
import {
  useAdminUsers,
  useCreateTask,
  useDeleteTask,
  useUpdateTask,
} from '@/lib/api/hooks';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Spinner } from '@/components/ui/spinner';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { FieldError } from '@/components/auth/field-error';
import { Modal } from '@/components/lessons/modal';

const NO_ASSIGNEE = 'none';

const STATUS_LABEL_KEY: Record<TaskStatus, string> = {
  todo: 'columnTodo',
  doing: 'columnDoing',
  done: 'columnDone',
};

/**
 * Create/edit dialog for a Задачи card. `task` present → edit (+ delete);
 * absent → create (defaults to status='todo' server-side).
 */
export function TaskEditDialog({
  open,
  onClose,
  task,
}: {
  open: boolean;
  onClose: () => void;
  task: TaskDto | null;
}) {
  const t = useTranslations('tasks');
  const tc = useTranslations('common');
  const { data: users } = useAdminUsers();
  const createTask = useCreateTask();
  const updateTask = useUpdateTask();
  const deleteTask = useDeleteTask();

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [assigneeId, setAssigneeId] = useState<string>(NO_ASSIGNEE);
  const [deadline, setDeadline] = useState('');
  const [status, setStatus] = useState<TaskStatus>('todo');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setTitle(task?.title ?? '');
    setDescription(task?.description ?? '');
    setAssigneeId(task?.assigneeId ?? NO_ASSIGNEE);
    setDeadline(task?.deadline ?? '');
    setStatus(task?.status ?? 'todo');
    setError(null);
  }, [open, task]);

  const pending = createTask.isPending || updateTask.isPending;

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (title.trim().length < 2) {
      setError(t('titlePlaceholder'));
      return;
    }

    const assignee = assigneeId === NO_ASSIGNEE ? null : assigneeId;

    try {
      if (task) {
        await updateTask.mutateAsync({
          id: task.id,
          dto: {
            title: title.trim(),
            description: description.trim() || null,
            assigneeId: assignee,
            deadline: deadline || null,
            status,
          },
        });
      } else {
        await createTask.mutateAsync({
          title: title.trim(),
          description: description.trim() || undefined,
          assigneeId: assignee,
          deadline: deadline || null,
        });
      }
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed');
    }
  }

  async function onDelete() {
    if (!task) return;
    if (!window.confirm(t('deleteConfirm', { title: task.title }))) return;
    await deleteTask.mutateAsync(task.id);
    onClose();
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={task ? task.title : t('newTaskTitle')}
    >
      <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="task-title">{t('titlePlaceholder')}</Label>
          <Input
            id="task-title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            autoFocus
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="task-desc">{t('description')}</Label>
          <Textarea
            id="task-desc"
            value={description}
            placeholder={t('descriptionPlaceholder')}
            onChange={(e) => setDescription(e.target.value)}
            rows={3}
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="task-assignee">{t('assignee')}</Label>
            <Select value={assigneeId} onValueChange={setAssigneeId}>
              <SelectTrigger id="task-assignee">
                {/* Radix Select.Value only resolves a matched item's label
                    once the content has mounted at least once; passing the
                    label explicitly avoids a blank trigger on first render
                    whenever the current value isn't the first item. */}
                <SelectValue>
                  {assigneeId === NO_ASSIGNEE
                    ? t('noAssignee')
                    : (users ?? []).find((u) => u.id === assigneeId)?.fullName ??
                      (users ?? []).find((u) => u.id === assigneeId)?.email}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NO_ASSIGNEE}>{t('noAssignee')}</SelectItem>
                {(users ?? []).map((u) => (
                  <SelectItem key={u.id} value={u.id}>
                    {u.fullName ?? u.email}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="task-deadline">{t('deadline')}</Label>
            <Input
              id="task-deadline"
              type="date"
              value={deadline}
              onChange={(e) => setDeadline(e.target.value)}
            />
          </div>
        </div>

        {task ? (
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="task-status">{t('status')}</Label>
            <Select
              value={status}
              onValueChange={(v) => {
                // Radix can emit a transient '' while its content remounts
                // (observed under StrictMode); ignore anything that isn't a
                // real status rather than let it clear the field.
                if ((taskStatusEnum.options as readonly string[]).includes(v)) {
                  setStatus(v as TaskStatus);
                }
              }}
            >
              <SelectTrigger id="task-status">
                <SelectValue>
                  {STATUS_LABEL_KEY[status] ? t(STATUS_LABEL_KEY[status]) : ''}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {taskStatusEnum.options.map((s) => (
                  <SelectItem key={s} value={s}>
                    {t(STATUS_LABEL_KEY[s])}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        ) : null}

        <FieldError message={error} />

        <div className="mt-2 flex items-center justify-between gap-2 border-t pt-4">
          {task ? (
            <Button
              type="button"
              variant="ghost"
              className="text-destructive hover:text-destructive"
              onClick={onDelete}
              disabled={deleteTask.isPending}
            >
              <Trash2 className="h-4 w-4" />
              {t('delete')}
            </Button>
          ) : (
            <span />
          )}
          <div className="flex gap-2">
            <Button type="button" variant="outline" onClick={onClose}>
              {tc('cancel')}
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? <Spinner /> : null}
              {task ? tc('save') : t('add')}
            </Button>
          </div>
        </div>
      </form>
    </Modal>
  );
}
