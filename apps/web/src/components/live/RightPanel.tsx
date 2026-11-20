'use client';

import * as React from 'react';
import { useTranslations } from 'next-intl';
import {
  ListChecks,
  Paperclip,
  NotebookPen,
  Bot,
  MessagesSquare,
  MessageCircleQuestion,
  Trophy,
} from 'lucide-react';
import type { Block } from '@/lib/api/types';
import type { ChatMessagePayload, QaQuestion } from '@lms/shared';
import { cn } from '@/lib/utils';
import { NavigationTab } from './NavigationTab';
import { MaterialsTab } from './MaterialsTab';
import { NotesTab } from './NotesTab';
import { TutorTab } from './TutorTab';
import { GroupChatTab } from './GroupChatTab';
import { QaPanel } from './QaPanel';
import { SessionRatingTab } from '@/components/rating/session-rating-tab';

type TabId = 'navigation' | 'qa' | 'chat' | 'materials' | 'notes' | 'tutor' | 'rating';

const TABS: { id: TabId; labelKey: string; Icon: typeof ListChecks }[] = [
  { id: 'chat', labelKey: 'tabChat', Icon: MessagesSquare },
  { id: 'qa', labelKey: 'tabQa', Icon: MessageCircleQuestion },
  { id: 'navigation', labelKey: 'tabNavigation', Icon: ListChecks },
  { id: 'materials', labelKey: 'tabMaterials', Icon: Paperclip },
  { id: 'notes', labelKey: 'tabNotes', Icon: NotebookPen },
  { id: 'tutor', labelKey: 'tabTutor', Icon: Bot },
];

/** Shown only when the panel knows the session (student live page). */
const RATING_TAB = { id: 'rating' as const, labelKey: 'tab', Icon: Trophy };

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
  /** Live Q&A queue */
  questions?: QaQuestion[];
  onAsk?: (text: string) => void;
  onVote?: (questionId: string) => void;
  /** Live session id — enables the «Рейтинг» tab. */
  sessionId?: string;
  /** Read the rating with the participant token (else the user token). */
  ratingAsParticipant?: boolean;
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
  questions = [],
  onAsk,
  onVote,
  sessionId,
  ratingAsParticipant = true,
  className,
}: RightPanelProps) {
  const t = useTranslations('rightPanel');
  const tr = useTranslations('rating');
  const tabs = sessionId ? [...TABS, RATING_TAB] : TABS;
  const [active, setActive] = React.useState<TabId>('chat');
  const openQuestions = questions.filter((q) => q.status !== 'answered').length;

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
        {tabs.map(({ id, labelKey, Icon }) => {
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
              <span className="relative">
                <Icon className="h-4 w-4" />
                {id === 'qa' && openQuestions > 0 ? (
                  <span className="absolute -right-2.5 -top-1.5 min-w-[16px] rounded-full bg-primary px-1 text-[9px] font-bold leading-4 text-primary-foreground">
                    {openQuestions}
                  </span>
                ) : null}
              </span>
              <span className="truncate">{id === 'rating' ? tr(labelKey) : t(labelKey)}</span>
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
        {active === 'qa' && (
          <QaPanel
            questions={questions}
            selfId={chatSelfId ?? null}
            onAsk={(text) => onAsk?.(text)}
            onVote={(id) => onVote?.(id)}
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
        {active === 'rating' && sessionId && (
          <SessionRatingTab sessionId={sessionId} asParticipant={ratingAsParticipant} />
        )}
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
