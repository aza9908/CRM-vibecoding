'use client';

import * as React from 'react';
import { useTranslations } from 'next-intl';
import { Send, Bot } from 'lucide-react';
import type { ChatMessage } from '@lms/shared';
import { useAiChat } from '@/lib/api/hooks/use-ai-chat';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Spinner } from '@/components/ui/spinner';

export interface AssistantPanelProps {
  /** Lesson the chat is scoped to (persisted server-side in ai_chats). */
  lessonId?: string;
  /** Content of the block the student is currently working on. */
  blockContent?: string;
  /** The student's current answer, injected as task context for the mentor. */
  taskContext?: string;
  className?: string;
}

/**
 * Socratic AI mentor chat. Wraps `useAiChat`, which POSTs to /ai/chat and reads
 * the SSE token stream. The current block content + the student's answer are
 * sent as context so the mentor can ask guiding questions about their work.
 */
export function AssistantPanel({
  lessonId,
  blockContent,
  taskContext,
  className,
}: AssistantPanelProps) {
  const t = useTranslations('ai');
  const { messages, streaming, isStreaming, error, send } = useAiChat();
  const [draft, setDraft] = React.useState('');
  const scrollRef = React.useRef<HTMLDivElement>(null);

  // Keep latest context in refs so a long-lived `send` closure stays current.
  const ctxRef = React.useRef({ lessonId, blockContent, taskContext });
  ctxRef.current = { lessonId, blockContent, taskContext };

  React.useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, streaming]);

  const handleSend = React.useCallback(() => {
    const text = draft.trim();
    if (!text || isStreaming) return;
    setDraft('');
    void send(text, ctxRef.current);
  }, [draft, isStreaming, send]);

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const hasConversation = messages.length > 0 || streaming.length > 0;

  return (
    <div
      className={cn(
        'flex h-full flex-col rounded-lg border bg-card text-card-foreground',
        className,
      )}
    >
      <div className="flex items-center gap-2 border-b px-4 py-3">
        <span className="flex h-7 w-7 items-center justify-center rounded-md bg-muted text-primary">
          <Bot className="h-4 w-4" />
        </span>
        <span className="text-sm font-semibold">{t('title')}</span>
      </div>

      <div
        ref={scrollRef}
        className="flex-1 space-y-3 overflow-y-auto p-4"
        aria-live="polite"
      >
        {!hasConversation && (
          <p className="text-sm text-muted-foreground">{t('intro')}</p>
        )}

        {messages.map((m, i) => (
          <ChatBubble key={i} message={m} t={t} />
        ))}

        {isStreaming && (
          <ChatBubble
            message={{ role: 'assistant', content: streaming }}
            streaming
            t={t}
          />
        )}

        {error && (
          <p className="text-sm text-destructive" role="alert">
            {t('error')}
          </p>
        )}
      </div>

      <div className="border-t p-3">
        <div className="flex items-end gap-2">
          <Textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder={t('placeholder')}
            rows={2}
            className="min-h-[44px] resize-none"
          />
          <Button
            type="button"
            size="icon"
            onClick={handleSend}
            disabled={isStreaming || draft.trim().length === 0}
            aria-label={t('send')}
          >
            {isStreaming ? <Spinner className="h-4 w-4" /> : <Send />}
          </Button>
        </div>
      </div>
    </div>
  );
}

function ChatBubble({
  message,
  streaming,
  t,
}: {
  message: ChatMessage;
  streaming?: boolean;
  t: ReturnType<typeof useTranslations>;
}) {
  const isUser = message.role === 'user';
  return (
    <div className={cn('flex flex-col', isUser ? 'items-end' : 'items-start')}>
      <span className="mb-1 text-xs font-medium text-muted-foreground">
        {isUser ? t('you') : t('assistant')}
      </span>
      <div
        className={cn(
          'max-w-[85%] whitespace-pre-wrap rounded-lg px-3 py-2 text-sm',
          isUser
            ? 'bg-primary text-primary-foreground'
            : 'bg-muted text-foreground',
        )}
      >
        {message.content}
        {streaming && message.content.length === 0 && (
          <span className="text-muted-foreground">{t('thinking')}</span>
        )}
      </div>
    </div>
  );
}
