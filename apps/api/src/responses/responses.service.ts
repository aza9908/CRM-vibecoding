import { Inject, Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { DRIZZLE, type Db } from '../db/db.module';
import {
  participants,
  responses,
} from '../db/schema';

/**
 * Row returned by {@link ResponsesService.listForSession}: a response joined
 * with the participant who authored it. Used by the teacher's "responses
 * summary" endpoint (`GET /sessions/:id/responses`).
 */
export interface SessionResponseSummary {
  id: string;
  participantId: string;
  participantName: string;
  blockId: string | null;
  answerText: string | null;
  isCompleted: boolean;
  updatedAt: Date | null;
}

@Injectable()
export class ResponsesService {
  constructor(@Inject(DRIZZLE) private readonly db: Db) {}

  /**
   * Insert or update a participant's answer to a block.
   *
   * Relies on the `responses_participant_block_idx` unique index
   * (participantId, blockId) — a second save for the same pair updates the
   * existing row instead of creating a duplicate. `updatedAt` is bumped so the
   * teacher's live summary can show recency. Returns the persisted row.
   */
  async upsert(participantId: string, blockId: string, answerText: string) {
    const now = new Date();
    const [row] = await this.db
      .insert(responses)
      .values({
        participantId,
        blockId,
        answerText,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: [responses.participantId, responses.blockId],
        set: {
          answerText,
          updatedAt: now,
        },
      })
      .returning();
    return row;
  }

  /**
   * The responses authored by a single participant. Used to seed a client's
   * answered-state on (re)entry (`GET /sessions/:id/my-responses`). Returns the
   * raw response rows; org/session isolation is enforced upstream (the caller
   * resolves which participantId belongs to them in this session).
   */
  async listForParticipant(participantId: string) {
    return this.db
      .select({
        id: responses.id,
        participantId: responses.participantId,
        blockId: responses.blockId,
        answerText: responses.answerText,
        isCompleted: responses.isCompleted,
        updatedAt: responses.updatedAt,
      })
      .from(responses)
      .where(eq(responses.participantId, participantId));
  }

  /**
   * All responses for a session, joined with the participant who authored each.
   * Scoped through the `participants.sessionId` foreign key, so it only returns
   * answers from participants of this exact session. Org isolation is enforced
   * upstream (the controller asserts the session belongs to the caller's org).
   */
  async listForSession(sessionId: string): Promise<SessionResponseSummary[]> {
    const rows = await this.db
      .select({
        id: responses.id,
        participantId: responses.participantId,
        participantName: participants.name,
        blockId: responses.blockId,
        answerText: responses.answerText,
        isCompleted: responses.isCompleted,
        updatedAt: responses.updatedAt,
      })
      .from(responses)
      .innerJoin(participants, eq(responses.participantId, participants.id))
      .where(eq(participants.sessionId, sessionId));

    return rows.map((r) => ({
      id: r.id,
      participantId: r.participantId ?? '',
      participantName: r.participantName,
      blockId: r.blockId,
      answerText: r.answerText,
      isCompleted: r.isCompleted ?? false,
      updatedAt: r.updatedAt,
    }));
  }
}
