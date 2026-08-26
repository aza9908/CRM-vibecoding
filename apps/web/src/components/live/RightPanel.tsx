'use client';

import * as React from 'react';
import { useTranslations } from 'next-intl';
import { ListChecks, Paperclip, NotebookPen, Bot, MessagesSquare } from 'lucide-react';
import type { Block } from '@/lib/api/types';
import type { ChatMessagePayload } from '@lms/shared';
import { cn } from '@/lib/utils';
import { NavigationTab } from './NavigationTab';
import { MaterialsTab } from './MaterialsTab';
import { NotesTab } from './NotesTab';
import { TutorTab } from './TutorTab';
import { GroupChatTab } from './GroupChatTab';

type TabId = 'navigation' | 'chat' | 'materials' | 'notes' | 'tutor';

const TABS: { id: TabId; labelKey: string; Icon: typeof ListChecks }[] = [
  { id: 'navigation', labelKey: 'tabNavigation', Icon: ListChecks },
  { id: 'chat', labelKey: 'tabChat', Icon: MessagesSquare },
  { id: 'materials', labelKey: 'tabMaterials', Icon: Paperclip },
  { id: 'notes', labelKey: 'tabNotes', Icon: NotebookPen },
  { id: 'tutor', labelKey: 'tabTutor', Icon: Bot },
];

export interface RightPanelProps {
  lessonId: string | undefined;
  blocks: Block[];
  answered: Set<string>;
  focusedBlockId: string | null;
  activeBlockId?: string | null;
  percent: number;
  onSelectBlock: (blockId: string) => void;
  blockContent?: string;
  taskContext?: string;
  /** Live group chat */
  chatMessages?: ChatMessagePayload[];
  onSendChat?: (text: string) => void;
  chatSelfId?: string | null;
  className?: string;
}

/**
 * Right-side panel: Навигация · Чат · Материалы · Заметки · ИИ.
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
  chatMessages = [],
  onSendChat,
  chatSelfId,
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
                'flex flex-1 flex-col items-center gap-1 px-0.5 py-2 text-[10px] font-medium transition-colors sm:text-xs',
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
          active === 'tutor' || active === 'chat'
            ? 'overflow-hidden p-3'
            : 'overflow-y-auto p-3',
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
        {active === 'chat' && (
          <GroupChatTab
            messages={chatMessages}
            onSend={(text) => onSendChat?.(text)}
            selfId={chatSelfId}
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
