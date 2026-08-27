'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { useTranslations } from 'next-intl';
import { GripVertical, Pencil, Plus, Trash2 } from 'lucide-react';
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
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
  useReorderLessons,
  useReorderModules,
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

/** One draggable lesson row inside a module's lesson list. */
function SortableLessonRow({ lesson }: { lesson: CurriculumLesson }) {
  const t = useTranslations('program');
  const tl = useTranslations('lessons');
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: lesson.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.6 : 1,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className="flex items-center gap-2 rounded-md border bg-background p-1.5 text-sm"
    >
      <button
        type="button"
        className="shrink-0 cursor-grab touch-none rounded p-1 text-muted-foreground/60 transition-colors hover:bg-accent hover:text-foreground"
        aria-label={t('dragToReorder')}
        {...attributes}
        {...listeners}
      >
        <GripVertical className="h-3.5 w-3.5" />
      </button>
      <span className="min-w-0 flex-1 truncate">{lesson.title}</span>
      {lesson.kind ? (
        <span className="shrink-0 text-xs text-muted-foreground">
          {tl(KIND_LABEL_KEY[lesson.kind])}
        </span>
      ) : null}
    </div>
  );
}

/** Drag-and-drop reorderable list of one module's lessons. Local order is
 * optimistic; each drop persists via `PUT /program/modules/:id/lessons/order`. */
function ModuleLessonsList({
  moduleId,
  lessons,
}: {
  moduleId: string;
  lessons: CurriculumLesson[];
}) {
  const t = useTranslations('program');
  const reorder = useReorderLessons(moduleId);
  const [order, setOrder] = useState(lessons);

  useEffect(() => setOrder(lessons), [lessons]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  function onDragEnd(e: DragEndEvent) {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const from = order.findIndex((l) => l.id === active.id);
    const to = order.findIndex((l) => l.id === over.id);
    if (from < 0 || to < 0) return;
    const next = arrayMove(order, from, to);
    setOrder(next);
    reorder.mutate(next.map((l) => l.id));
  }

  if (order.length === 0) {
    return <p className="pl-1 text-xs text-muted-foreground">{t('noLessonsInModule')}</p>;
  }

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
      <SortableContext items={order.map((l) => l.id)} strategy={verticalListSortingStrategy}>
        <div className="flex flex-col gap-1.5">
          {order.map((lesson) => (
            <SortableLessonRow key={lesson.id} lesson={lesson} />
          ))}
        </div>
      </SortableContext>
    </DndContext>
  );
}

/** Inline rename/delete row for one existing module, draggable to reorder
 * against sibling modules, with its lessons listed (and reorderable) below. */
function ModuleRow({
  moduleId,
  title,
  code,
  lessons,
}: {
  moduleId: string;
  title: string;
  code: string | null;
  lessons: CurriculumLesson[];
}) {
  const t = useTranslations('program');
  const tc = useTranslations('common');
  const update = useUpdateModule(moduleId);
  const remove = useDeleteModule();

  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: moduleId });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.6 : 1,
  };

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

  return (
    <div ref={setNodeRef} style={style} className="rounded-md border p-2">
      {editing ? (
        <div className="flex items-center gap-2">
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
      ) : (
        <div className="flex items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2">
            <button
              type="button"
              className="shrink-0 cursor-grab touch-none rounded p-1 text-muted-foreground/60 transition-colors hover:bg-accent hover:text-foreground"
              aria-label={t('dragToReorder')}
              {...attributes}
              {...listeners}
            >
              <GripVertical className="h-4 w-4" />
            </button>
            <span className="truncate text-sm">
              {code ? <span className="text-muted-foreground">{code} · </span> : null}
              {title}
            </span>
          </div>
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
      )}
      <div className="mt-2 pl-6">
        <ModuleLessonsList moduleId={moduleId} lessons={lessons} />
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
  const reorderModules = useReorderModules();

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

  const [moduleOrder, setModuleOrder] = useState(modules);
  useEffect(() => setModuleOrder(modules), [modules]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  function onModuleDragEnd(e: DragEndEvent) {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const from = moduleOrder.findIndex((m) => m.id === active.id);
    const to = moduleOrder.findIndex((m) => m.id === over.id);
    if (from < 0 || to < 0) return;
    const next = arrayMove(moduleOrder, from, to);
    setModuleOrder(next);
    reorderModules.mutate(next.map((m) => m.id));
  }

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

        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={onModuleDragEnd}
        >
          <SortableContext
            items={moduleOrder.map((m) => m.id)}
            strategy={verticalListSortingStrategy}
          >
            <div className="flex flex-col gap-2">
              {moduleOrder.map((m) => (
                <ModuleRow
                  key={m.id}
                  moduleId={m.id}
                  title={m.title}
                  code={m.code}
                  lessons={m.lessons}
                />
              ))}
            </div>
          </SortableContext>
        </DndContext>

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
