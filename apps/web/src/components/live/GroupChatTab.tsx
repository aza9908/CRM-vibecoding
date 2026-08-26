'use client';

import * as React from 'react';
import { useTranslations } from 'next-intl';
import { Send } from 'lucide-react';
import type { ChatMessagePayload } from '@lms/shared';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

const MAX_LEN = 500;

export function GroupChatTab({
  messages,
  onSend,
  selfId,
}: {
  messages: ChatMessagePayload[];
  onSend: (text: string) => void;
  /** Current user/participant id — own bubbles align right. */
  selfId?: string | null;
}) {
  const t = useTranslations('rightPanel');
  const [text, setText] = React.useState('');
  const bottomRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length]);

  function submit(e?: React.FormEvent) {
    e?.preventDefault();
    const trimmed = text.trim().slice(0, MAX_LEN);
    if (!trimmed) return;
    onSend(trimmed);
    setText('');
  }

  return (
    <div className="flex h-full min-h-[280px] flex-col">
      <p className="mb-2 text-xs text-muted-foreground">{t('chatHint')}</p>
      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto rounded-md border bg-muted/20 p-2">
        {messages.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            {t('chatEmpty')}
          </p>
        ) : (
          messages.map((m) => {
            const mine = selfId && m.senderId === selfId;
            return (
              <div
                key={m.id}
                className={cn(
                  'max-w-[90%] rounded-lg px-2.5 py-1.5 text-sm',
                  mine
                    ? 'ml-auto bg-primary text-primary-foreground'
                    : 'bg-card border',
                )}
              >
                <div
                  className={cn(
                    'mb-0.5 text-[10px] font-semibold uppercase tracking-wide',
                    mine ? 'text-primary-foreground/80' : 'text-muted-foreground',
                  )}
                >
                  {m.senderName}
                  {m.role === 'teacher' ? ` · ${t('chatTeacher')}` : ''}
                </div>
                <p className="whitespace-pre-wrap break-words">{m.text}</p>
              </div>
            );
          })
        )}
        <div ref={bottomRef} />
      </div>
      <form onSubmit={submit} className="mt-2 flex gap-2">
        <input
          value={text}
          onChange={(e) => setText(e.target.value.slice(0, MAX_LEN))}
          placeholder={t('chatPlaceholder')}
          className="h-9 flex-1 rounded-md border bg-background px-3 text-sm outline-none ring-offset-background focus-visible:ring-2 focus-visible:ring-ring"
          maxLength={MAX_LEN}
        />
        <Button type="submit" size="icon" disabled={!text.trim()} aria-label={t('chatSend')}>
          <Send className="h-4 w-4" />
        </Button>
      </form>
    </div>
  );
}
