'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { useTranslations } from 'next-intl';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import type { CurriculumModule, CurriculumTree } from '@lms/shared';
import {
  useCreateModule,
  useDeleteModule,
  useUpdateModule,
  useUpsertCourse,
} from '@/lib/api/hooks';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Spinner } from '@/components/ui/spinner';

/** Inline rename/delete row for one existing module. */
function ModuleRow({ moduleId, title, code }: { moduleId: string; title: string; code: string | null }) {
  const t = useTranslations('program');
  const tc = useTranslations('common');
  const update = useUpdateModule(moduleId);
  const remove = useDeleteModule();

  const [editing, setEditing] = useState(false);
  const [draftTitle, setDraftTitle] = useState(title);
  const [draftCode, setDraftCode] = useState(code ?? '');

  async function save() {
    if (draftTitle.trim().length < 1) return;
    await update.mutateAsync({
      title: draftTitle.trim(),
      code: draftCode.trim() || null,
    });
    setEditing(false);
  }

  async function onDelete() {
    if (!window.confirm(t('deleteModuleConfirm', { title }))) return;
    await remove.mutateAsync(moduleId);
  }

  if (editing) {
    return (
      <div className="flex items-center gap-2 rounded-md border p-2">
        <Input
          value={draftCode}
          onChange={(e) => setDraftCode(e.target.value)}
          placeholder={t('moduleCodePlaceholder')}
          className="w-24"
        />
        <Input
          value={draftTitle}
          onChange={(e) => setDraftTitle(e.target.value)}
          placeholder={t('moduleTitlePlaceholder')}
          className="flex-1"
          autoFocus
        />
        <Button type="button" size="sm" onClick={save} disabled={update.isPending}>
          {update.isPending ? <Spinner /> : null}
          {t('save')}
        </Button>
        <Button type="button" size="sm" variant="outline" onClick={() => setEditing(false)}>
          {tc('cancel')}
        </Button>
      </div>
    );
  }

  return (
    <div className="flex items-center justify-between gap-2 rounded-md border p-2">
      <span className="truncate text-sm">
        {code ? <span className="text-muted-foreground">{code} · </span> : null}
        {title}
      </span>
      <div className="flex shrink-0 gap-1">
        <Button
          type="button"
          size="icon"
          variant="ghost"
          aria-label={t('editModule')}
          onClick={() => setEditing(true)}
        >
          <Pencil className="h-4 w-4" />
        </Button>
        <Button
          type="button"
          size="icon"
          variant="ghost"
          className="text-destructive hover:text-destructive"
          aria-label={t('deleteModule')}
          onClick={onDelete}
          disabled={remove.isPending}
        >
          <Trash2 className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}

/**
 * Teacher/admin-only panel for managing the org's course + modules.
 * Reading the resulting tree stays on `useCurriculum()`; this only owns the
 * mutations (`/program/*`), which auto-invalidate that query on success.
 */
export function ProgramEditor({ curriculum }: { curriculum: CurriculumTree | undefined }) {
  const t = useTranslations('program');
  const tc = useTranslations('common');
  const upsertCourse = useUpsertCourse();
  const createModule = useCreateModule();

  const [courseTitle, setCourseTitle] = useState(curriculum?.course?.title ?? '');
  const [newModuleTitle, setNewModuleTitle] = useState('');
  const [newModuleCode, setNewModuleCode] = useState('');

  useEffect(() => {
    setCourseTitle(curriculum?.course?.title ?? '');
  }, [curriculum?.course?.title]);

  async function saveCourseTitle(e: FormEvent) {
    e.preventDefault();
    if (courseTitle.trim().length < 1) return;
    await upsertCourse.mutateAsync({ title: courseTitle.trim() });
  }

  async function addModule(e: FormEvent) {
    e.preventDefault();
    if (newModuleTitle.trim().length < 1) return;
    await createModule.mutateAsync({
      title: newModuleTitle.trim(),
      code: newModuleCode.trim() || undefined,
    });
    setNewModuleTitle('');
    setNewModuleCode('');
  }

  const modules: CurriculumModule[] = curriculum?.modules ?? [];

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('manageTitle')}</CardTitle>
        <p className="text-xs text-muted-foreground">{t('manageHint')}</p>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <form onSubmit={saveCourseTitle} className="flex items-end gap-2">
          <div className="flex flex-1 flex-col gap-1.5">
            <Label htmlFor="course-title">{t('courseTitle')}</Label>
            <Input
              id="course-title"
              value={courseTitle}
              onChange={(e) => setCourseTitle(e.target.value)}
              placeholder="Программа обучения"
            />
          </div>
          <Button type="submit" disabled={upsertCourse.isPending}>
            {upsertCourse.isPending ? <Spinner /> : null}
            {tc('save')}
          </Button>
        </form>

        <div className="flex flex-col gap-2">
          {modules.map((m) => (
            <ModuleRow key={m.id} moduleId={m.id} title={m.title} code={m.code} />
          ))}
        </div>

        <form onSubmit={addModule} className="flex items-end gap-2 border-t pt-4">
          <Input
            value={newModuleCode}
            onChange={(e) => setNewModuleCode(e.target.value)}
            placeholder={t('moduleCodePlaceholder')}
            className="w-28"
          />
          <Input
            value={newModuleTitle}
            onChange={(e) => setNewModuleTitle(e.target.value)}
            placeholder={t('moduleTitlePlaceholder')}
            className="flex-1"
          />
          <Button type="submit" disabled={createModule.isPending}>
            {createModule.isPending ? <Spinner /> : <Plus className="h-4 w-4" />}
            {t('addModule')}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
