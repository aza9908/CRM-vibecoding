'use client';

import * as React from 'react';
import { useTranslations } from 'next-intl';
import { MessagesSquare, X } from 'lucide-react';
import type { ChatMessagePayload } from '@lms/shared';
import { GroupChatTab } from './GroupChatTab';

/**
 * The session chat, always one tap away: a «Чат» button fixed in the corner
 * (with an unread counter) that opens the chat as a panel — a side sheet on
 * desktop, a bottom sheet on phones. People kept losing the chat when it
 * lived only at the bottom of the page.
 */
export function ChatDock({
  messages,
  onSend,
  selfId,
}: {
  messages: ChatMessagePayload[];
  onSend: (text: string) => void;
  selfId?: string | null;
}) {
  const t = useTranslations('rightPanel');
  const [open, setOpen] = React.useState(false);
  const [seen, setSeen] = React.useState(0);

  // Everything is "read" while the panel is open.
  React.useEffect(() => {
    if (open) setSeen(messages.length);
  }, [open, messages.length]);
  const unread = open
    ? 0
    : messages.slice(seen).filter((m) => !selfId || m.senderId !== selfId).length;

  React.useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={t('chatOpen')}
        className="fixed bottom-5 left-4 z-40 inline-flex h-12 items-center gap-2 rounded-full bg-primary pl-3.5 pr-4 text-sm font-semibold text-primary-foreground shadow-xl ring-4 ring-primary/15 transition hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-primary/40"
      >
        <MessagesSquare className="h-5 w-5" aria-hidden />
        {t('tabChat')}
        {unread > 0 ? (
          <span className="ml-0.5 min-w-[1.5rem] rounded-full bg-success px-1.5 text-center text-xs font-bold leading-6 text-success-foreground">
            {unread > 99 ? '99+' : unread}
          </span>
        ) : null}
      </button>
    );
  }

  return (
    <section
      role="dialog"
      aria-label={t('groupChat')}
      className="fixed inset-x-0 bottom-0 z-50 flex h-[70vh] flex-col rounded-t-2xl border bg-card text-card-foreground shadow-2xl sm:inset-x-auto sm:bottom-4 sm:left-4 sm:h-[min(34rem,calc(100vh-2rem))] sm:w-[22rem] sm:rounded-2xl"
    >
      <header className="flex items-center gap-2 border-b px-4 py-3">
        <MessagesSquare className="h-4 w-4 text-primary" aria-hidden />
        <h2 className="flex-1 text-sm font-semibold">{t('groupChat')}</h2>
        <button
          type="button"
          onClick={() => setOpen(false)}
          aria-label={t('chatClose')}
          className="rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <X className="h-4 w-4" />
        </button>
      </header>
      <div className="min-h-0 flex-1 p-3">
        <GroupChatTab messages={messages} onSend={onSend} selfId={selfId} />
      </div>
    </section>
  );
}
