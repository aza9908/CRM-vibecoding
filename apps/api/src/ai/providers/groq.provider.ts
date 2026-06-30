import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import OpenAI from 'openai';

import type {
  ChatMessage,
  LlmProvider,
  LlmStreamOptions,
} from './llm-provider.interface';

/**
 * Groq LLM provider.
 *
 * Groq exposes an OpenAI-compatible REST API, so we reuse the official `openai`
 * SDK with a different `baseURL`. The `GROQ_API_KEY` is read from config on the
 * server only and never leaves the backend (CLAUDE.md hard rule #4).
 */
@Injectable()
export class GroqProvider implements LlmProvider {
  private readonly logger = new Logger(GroqProvider.name);
  private readonly client: OpenAI;
  private readonly defaultModel: string;

  constructor(private readonly config: ConfigService) {
    const apiKey = this.config.get<string>('GROQ_API_KEY') ?? '';
    if (!apiKey) {
      // Don't crash boot — fail loudly only when a call is actually attempted.
      this.logger.warn(
        'GROQ_API_KEY is not set; AI calls will fail until it is configured.',
      );
    }
    this.client = new OpenAI({
      apiKey,
      baseURL: 'https://api.groq.com/openai/v1',
    });
    this.defaultModel =
      this.config.get<string>('GROQ_MODEL') ?? 'llama-3.3-70b-versatile';
  }

  /** Stream completion tokens as they are generated. */
  async *stream(
    messages: ChatMessage[],
    opts?: LlmStreamOptions,
  ): AsyncIterable<string> {
    const res = await this.client.chat.completions.create(
      {
        model: opts?.model ?? this.defaultModel,
        temperature: opts?.temperature ?? 0.4,
        max_tokens: opts?.maxTokens,
        messages,
        stream: true,
      },
      { signal: opts?.signal },
    );

    for await (const chunk of res) {
      const delta = chunk.choices[0]?.delta?.content;
      if (delta) {
        yield delta;
      }
    }
  }

  /** Non-streaming completion — returns the full assistant message text. */
  async complete(
    messages: ChatMessage[],
    opts?: LlmStreamOptions,
  ): Promise<string> {
    const res = await this.client.chat.completions.create(
      {
        model: opts?.model ?? this.defaultModel,
        temperature: opts?.temperature ?? 0.2,
        max_tokens: opts?.maxTokens,
        messages,
        stream: false,
      },
      { signal: opts?.signal },
    );

    return res.choices[0]?.message?.content ?? '';
  }
}
