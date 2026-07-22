import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/**
 * Thin wrapper around the Telegram Bot API's `sendMessage`. Used by the
 * Задачи (tasks) board to post updates to the team's Telegram chat/channel,
 * mirroring what the old internal-tasks tool did via its own bridge.
 *
 * Configured via `TELEGRAM_BOT_TOKEN` + `TELEGRAM_CHAT_ID` (apps/api/.env).
 * Both are optional: if either is missing, `notify` silently no-ops so task
 * management keeps working before/without a bot configured — it never blocks
 * or fails the caller's request.
 */
@Injectable()
export class TelegramService {
  private readonly logger = new Logger(TelegramService.name);
  private readonly token?: string;
  private readonly chatId?: string;

  constructor(config: ConfigService) {
    this.token = config.get<string>('TELEGRAM_BOT_TOKEN') || undefined;
    this.chatId = config.get<string>('TELEGRAM_CHAT_ID') || undefined;
  }

  get isConfigured(): boolean {
    return !!this.token && !!this.chatId;
  }

  /** Send a message; failures are logged, never thrown (best-effort). */
  async notify(text: string): Promise<void> {
    if (!this.token || !this.chatId) return;
    try {
      const res = await fetch(
        `https://api.telegram.org/bot${this.token}/sendMessage`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: this.chatId,
            text,
            parse_mode: 'HTML',
          }),
        },
      );
      if (!res.ok) {
        const body = await res.text();
        this.logger.warn(`Telegram notify failed: ${res.status} ${body}`);
      }
    } catch (err) {
      this.logger.warn(`Telegram notify error: ${(err as Error).message}`);
    }
  }
}
