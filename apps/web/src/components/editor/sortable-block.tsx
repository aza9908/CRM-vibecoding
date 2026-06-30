'use client';

import type { CSSProperties } from 'react';
import { useTranslations } from 'next-intl';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { GripVertical, Trash2, Sparkles } from 'lucide-react';
import type { EditorBlock } from './editor-block';
import { blockLabelKey } from '@/lib/blocks';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { BlockEditor } from './block-editor';

type Patch = Partial<Omit<EditorBlock, 'localId' | 'type'>>;

/** One draggable workbook block in the editor list. */
export function SortableBlock({
  block,
  index,
  onChange,
  onDelete,
}: {
  block: EditorBlock;
  index: number;
  onChange: (localId: string, patch: Patch) => void;
  onDelete: (localId: string) => void;
}) {
  void index;
  const t = useTranslations('editor');
  const tc = useTranslations('common');
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: block.localId });

  const style: CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.6 : 1,
  };

  return (
    <Card
      ref={setNodeRef}
      style={style}
      className="group border shadow-none transition-colors hover:border-primary/40"
    >
      <CardHeader className="flex-row items-center justify-between space-y-0 px-5 py-3">
        <div className="flex items-center gap-2">
          <button
            type="button"
            className="-ml-1 cursor-grab touch-none rounded p-1 text-muted-foreground/60 transition-colors hover:bg-accent hover:text-foreground"
            aria-label={t('dragToReorder')}
            {...attributes}
            {...listeners}
          >
            <GripVertical className="h-4 w-4" />
          </button>
          <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            {t(blockLabelKey(block.type))}
          </span>
          {block.generatedBy === 'ai' ? (
            <Badge variant="secondary" className="gap-1">
              <Sparkles className="h-3 w-3" />
              AI
            </Badge>
          ) : null}
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-8 w-8 text-muted-foreground opacity-0 transition-opacity hover:text-destructive group-hover:opacity-100"
          onClick={() => onDelete(block.localId)}
          aria-label={tc('delete')}
        >
          <Trash2 />
        </Button>
      </CardHeader>
      <CardContent className="px-5 pb-5 pt-0">
        <BlockEditor
          block={block}
          onChange={(patch) => onChange(block.localId, patch)}
        />
      </CardContent>
    </Card>
  );
}
