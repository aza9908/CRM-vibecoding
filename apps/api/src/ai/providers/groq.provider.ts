import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import OpenAI, { toFile } from 'openai';

import type {
  ChatMessage,
  LlmProvider,
  LlmStreamOptions,
  TranscribeInput,
  TranscribeResult,
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
  private readonly transcribeModel: string;

  constructor(private readonly config: ConfigService) {
    // .trim(): a secret set via `echo "$key" | secrets:set` (rather than
    // `printf '%s'`) picks up a trailing newline that Secret Manager stores
    // verbatim — the key still "looks right" everywhere (length off by one
    // is easy to miss) but every request fails, since a raw \n in a header
    // value gets rejected outright by fetch/undici with "not a legal HTTP
    // header value". Cheap insurance against that class of mistake.
    const apiKey = (this.config.get<string>('GROQ_API_KEY') ?? '').trim();
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
    // `llama-3.3-70b-versatile` (the previous default) has been retired from
    // Groq's catalog — GET /openai/v1/models no longer lists it, and every
    // completion call 404s with "model_not_found". Verified against the
    // live API on 2026-08-29 that `openai/gpt-oss-120b` is available and
    // produces well-formed Russian JSON output for this app's block-
    // generation prompts.
    this.defaultModel =
      this.config.get<string>('GROQ_MODEL') ?? 'openai/gpt-oss-120b';    // Whisper on Groq: the turbo model is ~8× cheaper than large-v3 and
    // handles Russian / Uzbek / Kazakh lessons well.
    this.transcribeModel =
      this.config.get<string>('GROQ_TRANSCRIBE_MODEL') ?? 'whisper-large-v3-turbo';
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

  /**
   * Speech-to-text through Groq's OpenAI-compatible `/audio/transcriptions`
   * (Whisper). `verbose_json` returns segment timestamps. The endpoint
   * accepts files up to 25 MB.
   */
  async transcribe(input: TranscribeInput): Promise<TranscribeResult> {
    const file = await toFile(input.audio, input.fileName, { type: input.mimeType });
    const res = (await this.client.audio.transcriptions.create(
      {
        file,
        model: this.transcribeModel,
        response_format: 'verbose_json',
        temperature: 0,
        ...(input.language ? { language: input.language } : {}),
      },
      { signal: input.signal, timeout: 10 * 60_000 },
    )) as unknown as {
      text?: string;
      duration?: number;
      language?: string;
      segments?: { start?: number; end?: number; text?: string }[];
    };
    const segments = (res.segments ?? [])
      .map((s) => ({
        start: Number(s.start) || 0,
        end: Number(s.end) || 0,
        text: (s.text ?? '').trim(),
      }))
      .filter((s) => s.text.length > 0);
    return {
      text: (res.text ?? '').trim(),
      segments,
      durationSec: typeof res.duration === 'number' ? Math.round(res.duration) : null,
      language: res.language ?? null,
    };
  }
}
