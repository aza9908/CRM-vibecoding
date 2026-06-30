import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';

import type {
  ChatMessage,
  LlmProvider,
  LlmStreamOptions,
} from './llm-provider.interface';

/**
 * Claude LLM provider — optional alternative to {@link GroqProvider}.
 *
 * This is an intentionally thin, dependency-free stub: switching the project
 * onto Claude is a matter of (a) adding `@anthropic-ai/sdk`, (b) implementing
 * the two methods below against the Messages API, and (c) flipping the
 * `LLM_PROVIDER` binding in `ai.module.ts` to `ClaudeProvider`. The controller
 * and `AiService` never change.
 *
 * Until then it stays compilable and throws a clear 503 if accidentally wired
 * in without an API key / SDK.
 */
@Injectable()
export class ClaudeProvider implements LlmProvider {
  private readonly logger = new Logger(ClaudeProvider.name);

  private notConfigured(): never {
    this.logger.error(
      'ClaudeProvider is not configured. Add @anthropic-ai/sdk + ANTHROPIC_API_KEY ' +
        'and implement stream()/complete(), or keep LLM_PROVIDER bound to GroqProvider.',
    );
    throw new ServiceUnavailableException('Claude provider is not configured.');
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars, require-yield
  async *stream(
    _messages: ChatMessage[],
    _opts?: LlmStreamOptions,
  ): AsyncIterable<string> {
    this.notConfigured();
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async complete(
    _messages: ChatMessage[],
    _opts?: LlmStreamOptions,
  ): Promise<string> {
    this.notConfigured();
  }
}
