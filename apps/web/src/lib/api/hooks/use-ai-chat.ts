'use client';

import { useCallback, useRef, useState } from 'react';
import type { ChatDto, ChatMessage } from '@lms/shared';
import { API_URL } from '@/lib/api/client';
import { getAccessToken } from '@/lib/store/auth-store';

export interface UseAiChatResult {
  /** Full conversation (user + assistant turns). */
  messages: ChatMessage[];
  /** The assistant text currently streaming in (may be partial). */
  streaming: string;
  isStreaming: boolean;
  error: string | null;
  /** Send a user message; assistant reply streams in token by token. */
  send: (
    userMessage: string,
    context?: Pick<ChatDto, 'lessonId' | 'blockContent' | 'taskContext'>,
  ) => Promise<void>;
  /** Abort the in-flight stream. */
  stop: () => void;
  reset: () => void;
}

/**
 * SSE chat against POST /ai/chat. The endpoint streams lines of the form
 *   data: {"token":"..."}\n\n
 * terminated by
 *   data: [DONE]\n\n
 * We accumulate tokens into `streaming`, then commit a full assistant message.
 */
export function useAiChat(): UseAiChatResult {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [streaming, setStreaming] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const stop = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
  }, []);

  const reset = useCallback(() => {
    stop();
    setMessages([]);
    setStreaming('');
    setError(null);
    setIsStreaming(false);
  }, [stop]);

  const send = useCallback<UseAiChatResult['send']>(
    async (userMessage, context) => {
      setError(null);

      const history = messages;
      const next: ChatMessage[] = [
        ...history,
        { role: 'user', content: userMessage },
      ];
      setMessages(next);
      setStreaming('');
      setIsStreaming(true);

      const controller = new AbortController();
      abortRef.current = controller;

      const body: ChatDto = {
        userMessage,
        history,
        ...context,
      };

      let accumulated = '';
      try {
        const token = getAccessToken();
        const res = await fetch(`${API_URL}/ai/chat`, {
          method: 'POST',
          credentials: 'include',
          signal: controller.signal,
          headers: {
            'Content-Type': 'application/json',
            Accept: 'text/event-stream',
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          body: JSON.stringify(body),
        });

        if (!res.ok || !res.body) {
          throw new Error(`ai_chat_failed_${res.status}`);
        }

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });

          // SSE events are separated by a blank line.
          const events = buffer.split('\n\n');
          buffer = events.pop() ?? '';

          for (const evt of events) {
            const dataLines = evt
              .split('\n')
              .filter((l) => l.startsWith('data:'))
              .map((l) => l.slice(5).trim());
            const data = dataLines.join('\n');
            if (!data) continue;
            if (data === '[DONE]') {
              buffer = '';
              break;
            }
            try {
              const parsed = JSON.parse(data) as { token?: string };
              if (parsed.token) {
                accumulated += parsed.token;
                setStreaming(accumulated);
              }
            } catch {
              // Plain-text token fallback.
              accumulated += data;
              setStreaming(accumulated);
            }
          }
        }

        setMessages((prev) => [
          ...prev,
          { role: 'assistant', content: accumulated },
        ]);
      } catch (e) {
        if ((e as Error)?.name === 'AbortError') {
          // Commit whatever we streamed so far on manual stop.
          if (accumulated) {
            setMessages((prev) => [
              ...prev,
              { role: 'assistant', content: accumulated },
            ]);
          }
        } else {
          setError((e as Error)?.message ?? 'ai_chat_failed');
        }
      } finally {
        setStreaming('');
        setIsStreaming(false);
        abortRef.current = null;
      }
    },
    [messages],
  );

  return { messages, streaming, isStreaming, error, send, stop, reset };
}
