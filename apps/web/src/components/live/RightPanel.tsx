'use client';

import * as React from 'react';
import { useTranslations } from 'next-intl';
import { ListChecks, Paperclip, NotebookPen, Bot } from 'lucide-react';
import type { Block } from '@/lib/api/types';
import { cn } from '@/lib/utils';
import { NavigationTab } from './NavigationTab';
import { MaterialsTab } from './MaterialsTab';
import { NotesTab } from './NotesTab';
import { TutorTab } from './TutorTab';

type TabId = 'navigation' | 'materials' | 'notes' | 'tutor';

const TABS: { id: TabId; labelKey: string; Icon: typeof ListChecks }[] = [
  { id: 'navigation', labelKey: 'tabNavigation', Icon: ListChecks },
  { id: 'materials', labelKey: 'tabMaterials', Icon: Paperclip },
  { id: 'notes', labelKey: 'tabNotes', Icon: NotebookPen },
  { id: 'tutor', labelKey: 'tabTutor', Icon: Bot },
];

export interface RightPanelProps {
  lessonId: string | undefined;
  blocks: Block[];
  /** Ids of blocks the student has answered (responses + local answers). */
  answered: Set<string>;
  /** Teacher's currently focused block (from useSessionSocket). */
  focusedBlockId: string | null;
  /** The block the student is currently working on (null = none). */
  activeBlockId?: string | null;
  /** Lesson completion percent over interactive blocks (0–100). */
  percent: number;
  /** Scroll the named block into view in the center stage. */
  onSelectBlock: (blockId: string) => void;
  /** AI mentor context: the focused block's content + current answer. */
  blockContent?: string;
  taskContext?: string;
  className?: string;
}

/**
 * Right-side panel of the student live workbook (docs/08 §3): a tabbed
 * container with four tabs — Навигация · Материалы · Заметки · ИИ.
 *
 * The Tutor (AI) tab brings its own bordered card, so it renders edge-to-edge
 * without the shared panel chrome; the other three render inside a padded body.
 */
export function RightPanel({
  lessonId,
  blocks,
  answered,
  focusedBlockId,
  activeBlockId = null,
  percent,
  onSelectBlock,
  blockContent,
  taskContext,
  className,
}: RightPanelProps) {
  const t = useTranslations('rightPanel');
  const [active, setActive] = React.useState<TabId>('navigation');

  return (
    <div
      className={cn(
        'flex h-full flex-col overflow-hidden rounded-lg border bg-card text-card-foreground',
        className,
      )}
    >
      <div
        role="tablist"
        aria-label={t('title')}
        className="flex shrink-0 border-b"
      >
        {TABS.map(({ id, labelKey, Icon }) => {
          const selected = active === id;
          return (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={selected}
              onClick={() => setActive(id)}
              className={cn(
                'flex flex-1 flex-col items-center gap-1 px-1 py-2.5 text-xs font-medium transition-colors',
                selected
                  ? 'border-b-2 border-primary text-primary'
                  : 'border-b-2 border-transparent text-muted-foreground hover:text-foreground',
              )}
            >
              <Icon className="h-4 w-4" />
              <span className="truncate">{t(labelKey)}</span>
            </button>
          );
        })}
      </div>

      <div
        role="tabpanel"
        className={cn(
          'min-h-0 flex-1',
          // The Tutor tab is a self-contained card; others get a scrollable body.
          active === 'tutor' ? 'overflow-hidden' : 'overflow-y-auto p-3',
        )}
      >
        {active === 'navigation' && (
          <NavigationTab
            blocks={blocks}
            answered={answered}
            focusedBlockId={focusedBlockId}
            activeBlockId={activeBlockId}
            percent={percent}
            onSelect={onSelectBlock}
          />
        )}
        {active === 'materials' &&
          (lessonId ? (
            <MaterialsTab lessonId={lessonId} />
          ) : (
            <p className="py-10 text-center text-sm text-muted-foreground">
              {t('tabMaterials')}
            </p>
          ))}
        {active === 'notes' && <NotesTab lessonId={lessonId} />}
        {active === 'tutor' && (
          <TutorTab
            lessonId={lessonId}
            blockContent={blockContent}
            taskContext={taskContext}
          />
        )}
      </div>
    </div>
  );
}
