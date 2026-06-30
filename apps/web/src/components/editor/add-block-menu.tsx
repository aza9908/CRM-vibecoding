'use client';

import { useTranslations } from 'next-intl';
import { Plus } from 'lucide-react';
import type { BlockType } from '@lms/shared';
import { ALL_BLOCK_TYPES, blockLabelKey } from '@/lib/blocks';
import { Button } from '@/components/ui/button';

/** Palette of block types — clicking one appends a new block of that type. */
export function AddBlockMenu({ onAdd }: { onAdd: (type: BlockType) => void }) {
  const t = useTranslations('editor');
  return (
    <div className="flex flex-col items-center gap-4 rounded-lg border border-dashed bg-card/40 px-4 py-6">
      <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
        <Plus className="h-4 w-4" />
        {t('addBlock')}
      </div>
      <div className="flex flex-wrap justify-center gap-2">
        {ALL_BLOCK_TYPES.map((type) => (
          <Button
            key={type}
            type="button"
            variant="outline"
            size="sm"
            onClick={() => onAdd(type)}
          >
            <Plus />
            {t(blockLabelKey(type))}
          </Button>
        ))}
      </div>
    </div>
  );
}
