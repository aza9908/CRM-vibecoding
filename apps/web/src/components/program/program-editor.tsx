'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { useTranslations } from 'next-intl';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import {
  lessonKindEnum,
  type CurriculumLesson,
  type CurriculumModule,
  type CurriculumTree,
  type LessonKind,
} from '@lms/shared';
import {
  useCreateModule,
  useDeleteModule,
  useUpdateModule,
  useUpdateLesson,
  useUpsertCourse,
} from '@/lib/api/hooks';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Spinner } from '@/components/ui/spinner';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

const KIND_LABEL_KEY: Record<LessonKind, string> = {
  intro: 'kindIntro',
  workshop: 'kindWorkshop',
  qa: 'kindQa',
  demo_day: 'kindDemoDay',
};

/** Sentinel value for "no kind selected" — Radix Select can't hold '' as an item value. */
const KIND_NONE = '__none__';

/** One module-less lesson, with controls to assign it a module + kind so it
 * shows up in the curriculum timeline and schedule. */
function UnassignedLessonRow({
  lesson,
  modules,
}: {
  lesson: CurriculumLesson;
  modules: CurriculumModule[];
}) {
  const t = useTranslations('program');
  const tl = useTranslations('lessons');
  const update = useUpdateLesson(lesson.id);

  const [moduleId, setModuleId] = useState('');
  const [kind, setKind] = useState<LessonKind | typeof KIND_NONE>(
    lesson.kind ?? KIND_NONE,
  );

  async function assign() {
    if (!moduleId) return;
    await update.mutateAsync({
      moduleId,
      kind: kind === KIND_NONE ? undefined : kind,
    });
  }

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-md border p-2">
      <span className="min-w-0 flex-1 truncate text-sm font-medium">
        {lesson.title}
      </span>
      <Select value={moduleId} onValueChange={setModuleId}>
        <SelectTrigger className="h-8 w-44">
          <SelectValue placeholder={t('chooseModule')} />
        </SelectTrigger>
        <SelectContent>
          {modules.map((m) => (
            <SelectItem key={m.id} value={m.id}>
              {m.code ? `${m.code} · ` : ''}
              {m.title}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Select
        value={kind}
        onValueChange={(v) => setKind(v as LessonKind | typeof KIND_NONE)}
      >
        <SelectTrigger className="h-8 w-36">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={KIND_NONE}>{tl('kindNone')}</SelectItem>
          {lessonKindEnum.options.map((k) => (
            <SelectItem key={k} value={k}>
              {tl(KIND_LABEL_KEY[k])}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Button
        type="button"
        size="sm"
        onClick={assign}
        disabled={!moduleId || update.isPending}
      >
        {update.isPending ? <Spinner /> : null}
        {t('assign')}
      </Button>
    </div>
  );
}

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

  // The `unassigned` id is a synthetic bucket the API builds for module-less
  // lessons (see curriculum.service.ts) — it is never a real module row and
  // must never be sent to /program/modules/* (ParseUUIDPipe would reject it).
  const allModules: CurriculumModule[] = curriculum?.modules ?? [];
  const modules = allModules.filter((m) => m.id !== 'unassigned');
  const unassignedLessons =
    allModules.find((m) => m.id === 'unassigned')?.lessons ?? [];

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

        {unassignedLessons.length > 0 ? (
          <div className="flex flex-col gap-2 border-t pt-4">
            <Label className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              {t('unassignedLessonsTitle')}
            </Label>
            <p className="text-xs text-muted-foreground">
              {modules.length > 0 ? t('unassignedLessonsHint') : t('noModulesYet')}
            </p>
            {modules.length > 0 ? (
              <div className="flex flex-col gap-2">
                {unassignedLessons.map((lesson) => (
                  <UnassignedLessonRow
                    key={lesson.id}
                    lesson={lesson}
                    modules={modules}
                  />
                ))}
              </div>
            ) : null}
          </div>
        ) : null}

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
