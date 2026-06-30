'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Check, Save, Sparkles } from 'lucide-react';
import {
  DndContext,
  PointerSensor,
  KeyboardSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import type { BlockType } from '@lms/shared';
import type { Block } from '@/lib/api/types';
import { useLesson, useSaveBlocks } from '@/lib/api/hooks';
import { Link } from '@/i18n/routing';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Spinner } from '@/components/ui/spinner';
import {
  type EditorBlock,
  createBlock,
  draftKey,
  toBlockDtos,
  toEditorBlocks,
} from './editor-block';
import { SortableBlock } from './sortable-block';
import { AddBlockMenu } from './add-block-menu';
import { AiGenerateDialog } from './ai-generate-dialog';
import { LessonMaterialsPanel } from './lesson-materials-panel';

type Patch = Partial<Omit<EditorBlock, 'localId' | 'type'>>;

/** Read a persisted draft (array of editor blocks) from localStorage. */
function loadDraft(lessonId: string): EditorBlock[] | null {
  try {
    const raw = localStorage.getItem(draftKey(lessonId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as EditorBlock[];
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/** The workbook builder for a single lesson. */
export function EditorView({ lessonId }: { lessonId: string }) {
  const t = useTranslations('editor');
  const tc = useTranslations('common');
  const { data: lesson, isLoading, isError } = useLesson(lessonId);
  const saveBlocks = useSaveBlocks(lessonId);

  const [blocks, setBlocks] = useState<EditorBlock[]>([]);
  const [hydrated, setHydrated] = useState(false);
  // `dirty` = there are edits not yet published to the server.
  const [dirty, setDirty] = useState(false);
  // `draftSaved` = the most recent edits have been flushed to localStorage.
  const [draftSaved, setDraftSaved] = useState(false);
  const [aiOpen, setAiOpen] = useState(false);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  // Hydrate once: prefer a local draft, else the server's persisted blocks.
  useEffect(() => {
    if (hydrated || isLoading) return;
    const draft = loadDraft(lessonId);
    if (draft && draft.length > 0) {
      setBlocks(draft);
    } else if (lesson?.blocks) {
      setBlocks(toEditorBlocks(lesson.blocks));
    }
    setHydrated(true);
  }, [hydrated, isLoading, lesson, lessonId]);

  // Debounced autosave of the draft to localStorage.
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!hydrated) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      try {
        localStorage.setItem(draftKey(lessonId), JSON.stringify(blocks));
        setDraftSaved(true);
      } catch {
        /* storage may be full / unavailable */
      }
    }, 500);
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
  }, [blocks, hydrated, lessonId]);

  const ids = useMemo(() => blocks.map((b) => b.localId), [blocks]);

  const markDirty = useCallback(() => {
    setDirty(true);
    setDraftSaved(false);
  }, []);

  const addBlock = useCallback(
    (type: BlockType) => {
      setBlocks((prev) => [...prev, createBlock(type)]);
      markDirty();
    },
    [markDirty],
  );

  const patchBlock = useCallback(
    (localId: string, patch: Patch) => {
      setBlocks((prev) =>
        prev.map((b) => (b.localId === localId ? { ...b, ...patch } : b)),
      );
      markDirty();
    },
    [markDirty],
  );

  const deleteBlock = useCallback(
    (localId: string) => {
      setBlocks((prev) => prev.filter((b) => b.localId !== localId));
      markDirty();
    },
    [markDirty],
  );

  const onDragEnd = useCallback(
    (e: DragEndEvent) => {
      const { active, over } = e;
      if (!over || active.id === over.id) return;
      setBlocks((prev) => {
        const from = prev.findIndex((b) => b.localId === active.id);
        const to = prev.findIndex((b) => b.localId === over.id);
        if (from < 0 || to < 0) return prev;
        return arrayMove(prev, from, to);
      });
      markDirty();
    },
    [markDirty],
  );

  const onAiGenerated = useCallback(
    (generated: Block[]) => {
      const editorBlocks = toEditorBlocks(generated).map((b) => ({
        ...b,
        // Strip server ids — these are AI suggestions to append, not existing rows.
        id: undefined,
        generatedBy: 'ai' as const,
      }));
      setBlocks((prev) => [...prev, ...editorBlocks]);
      markDirty();
    },
    [markDirty],
  );

  async function publish() {
    const dtos = toBlockDtos(blocks);
    const saved = await saveBlocks.mutateAsync(dtos);
    // Re-sync editor state to the persisted blocks (now all carry server ids).
    setBlocks(toEditorBlocks(saved));
    try {
      localStorage.removeItem(draftKey(lessonId));
    } catch {
      /* ignore */
    }
    setDirty(false);
    setDraftSaved(false);
  }

  if (isLoading) {
    return (
      <main className="container flex items-center gap-2 py-8 text-muted-foreground">
        <Spinner />
        {tc('loading')}
      </main>
    );
  }

  if (isError || !lesson) {
    return (
      <main className="container py-8">
        <p className="text-destructive">{tc('error')}</p>
        <Button asChild variant="outline" className="mt-4">
          <Link href="/teacher/lessons">{tc('back')}</Link>
        </Button>
      </main>
    );
  }

  return (
    <main className="container max-w-3xl py-8">
      <div className="mb-8 flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            {t('title')}
          </p>
          <h1 className="text-2xl font-bold tracking-tight">{lesson.title}</h1>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {dirty && draftSaved ? (
            <Badge variant="secondary" className="gap-1">
              <Save className="h-3 w-3" />
              {t('draftSaved')}
            </Badge>
          ) : null}
          <Button variant="ghost" onClick={() => setAiOpen(true)}>
            <Sparkles />
            {t('generateWithAi')}
          </Button>
          <Button onClick={publish} disabled={saveBlocks.isPending}>
            {saveBlocks.isPending ? <Spinner /> : <Check />}
            {saveBlocks.isSuccess && !saveBlocks.isPending && !dirty
              ? t('published')
              : t('publish')}
          </Button>
        </div>
      </div>

      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragEnd={onDragEnd}
      >
        <SortableContext items={ids} strategy={verticalListSortingStrategy}>
          <div className="flex flex-col gap-4">
            {blocks.map((block, index) => (
              <SortableBlock
                key={block.localId}
                block={block}
                index={index}
                onChange={patchBlock}
                onDelete={deleteBlock}
              />
            ))}
          </div>
        </SortableContext>
      </DndContext>

      <div className="mt-4">
        <AddBlockMenu onAdd={addBlock} />
      </div>

      <div className="mt-8">
        <LessonMaterialsPanel lessonId={lessonId} />
      </div>

      <AiGenerateDialog
        lessonId={lessonId}
        open={aiOpen}
        onClose={() => setAiOpen(false)}
        onGenerated={onAiGenerated}
      />
    </main>
  );
}
