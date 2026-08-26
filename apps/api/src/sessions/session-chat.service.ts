import {
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
} from '@nestjs/common';
import { desc, eq, sql } from 'drizzle-orm';
import { DRIZZLE, type Db } from '../db/db.module';
import { sessionChatMessages } from '../db/schema';

const CHAT_LIST_LIMIT = 200;
const CHAT_RATE_WINDOW_MS = 10_000;
const CHAT_RATE_MAX = 8;

export type SessionChatRow = {
  id: string;
  sessionId: string;
  senderId: string;
  senderName: string;
  role: 'teacher' | 'participant';
  text: string;
  at: string;
};

@Injectable()
export class SessionChatService {
  private readonly logger = new Logger(SessionChatService.name);
  private ensured = false;
  /** In-memory REST chat rate limit: senderId → timestamps. */
  private readonly chatHits = new Map<string, number[]>();

  constructor(@Inject(DRIZZLE) private readonly db: Db) {}

  private allowChat(senderId: string): boolean {
    const now = Date.now();
    const prev = this.chatHits.get(senderId) ?? [];
    const recent = prev.filter((t) => now - t < CHAT_RATE_WINDOW_MS);
    if (recent.length >= CHAT_RATE_MAX) {
      this.chatHits.set(senderId, recent);
      return false;
    }
    recent.push(now);
    this.chatHits.set(senderId, recent);
    return true;
  }

  /** Create chat table on older prod DBs that lack drizzle migrations. */
  async ensureSchema(): Promise<void> {
    if (this.ensured) return;
    try {
      await this.db.execute(sql`
        CREATE TABLE IF NOT EXISTS session_chat_messages (
          id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          session_id uuid NOT NULL REFERENCES live_sessions(id) ON DELETE CASCADE,
          sender_id uuid NOT NULL,
          sender_name text NOT NULL,
          role text NOT NULL,
          text text NOT NULL,
          created_at timestamptz DEFAULT now()
        )
      `);
      await this.db.execute(sql`
        CREATE INDEX IF NOT EXISTS session_chat_session_idx
          ON session_chat_messages (session_id)
      `);
      this.ensured = true;
    } catch (err) {
      this.logger.warn(
        `session_chat ensureSchema: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  async list(sessionId: string): Promise<SessionChatRow[]> {
    await this.ensureSchema();
    // Newest-first limit, then reverse for chronological UI.
    const rows = await this.db
      .select()
      .from(sessionChatMessages)
      .where(eq(sessionChatMessages.sessionId, sessionId))
      .orderBy(desc(sessionChatMessages.createdAt))
      .limit(CHAT_LIST_LIMIT);
    rows.reverse();
    return rows.map((r) => ({
      id: r.id,
      sessionId: r.sessionId,
      senderId: r.senderId,
      senderName: r.senderName,
      role: (r.role === 'teacher' ? 'teacher' : 'participant') as
        | 'teacher'
        | 'participant',
      text: r.text,
      at: (r.createdAt ?? new Date()).toISOString(),
    }));
  }

  async post(input: {
    sessionId: string;
    senderId: string;
    senderName: string;
    role: 'teacher' | 'participant';
    text: string;
  }): Promise<SessionChatRow> {
    if (!this.allowChat(input.senderId)) {
      throw new ForbiddenException('chat_rate_limited');
    }
    await this.ensureSchema();
    const [row] = await this.db
      .insert(sessionChatMessages)
      .values({
        sessionId: input.sessionId,
        senderId: input.senderId,
        senderName: input.senderName,
        role: input.role,
        text: input.text,
      })
      .returning();
    return {
      id: row.id,
      sessionId: row.sessionId,
      senderId: row.senderId,
      senderName: row.senderName,
      role: (row.role === 'teacher' ? 'teacher' : 'participant') as
        | 'teacher'
        | 'participant',
      text: row.text,
      at: (row.createdAt ?? new Date()).toISOString(),
    };
  }
}
