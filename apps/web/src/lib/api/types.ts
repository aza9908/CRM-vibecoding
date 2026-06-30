/**
 * Web-side response shapes for endpoints whose response type is not part of
 * the frozen @lms/shared contract. INPUT DTOs, enums, and zod schemas always
 * come from @lms/shared — never duplicate those here. These are only the
 * read-model shapes the REST API returns.
 */
import type {
  BlockDto,
  LessonType,
  UserRole,
  CurriculumOutcome,
} from '@lms/shared';

/** A persisted lesson row as returned by the API. */
export interface Lesson {
  id: string;
  title: string;
  type: LessonType;
  moduleId: string | null;
  organizationId: string;
  createdAt?: string;
  updatedAt?: string;
}

/** A persisted block (BlockDto with a guaranteed id + orderIndex). */
export interface Block extends BlockDto {
  id: string;
  orderIndex?: number;
}

/** GET /lessons/:id — lesson with its blocks and outcomes. */
export interface LessonDetail extends Lesson {
  blocks: Block[];
  outcomes: CurriculumOutcome[];
}

/** GET /sessions/:id — session state plus the lesson blocks to render. */
export interface SessionState {
  id: string;
  code: string;
  status: 'scheduled' | 'live' | 'ended';
  lessonId: string;
  focusedBlockId: string | null;
  organizationId: string;
  startTime?: string | null;
  endTime?: string | null;
  blocks?: Block[];
}

/** GET /sessions/live — a currently-running session, for "resume live". */
export interface LiveSessionSummary {
  id: string;
  code: string;
  lessonId: string | null;
  startTime?: string | null;
}

/** A participant row in a session. */
export interface SessionParticipant {
  id: string;
  name: string;
  userId: string | null;
  sessionId: string;
  joinedAt?: string;
}

/** A response row in the teacher's session summary. */
export interface SessionResponse {
  id: string;
  participantId: string;
  blockId: string;
  answerText: string;
  updatedAt: string;
}

/**
 * GET /sessions/:id/my-responses — the calling participant's own answers, used
 * to seed the navigation tab's "answered" set on entry. Only the block id is
 * load-bearing here; the rest mirrors a response row.
 */
export interface MyResponse {
  id: string;
  blockId: string;
  answerText: string | null;
  isCompleted: boolean;
  updatedAt?: string | null;
}

/** GET /auth/me — the current user. */
export interface MeResponse {
  id: string;
  email: string;
  fullName: string | null;
  role: UserRole;
  organizationId: string | null;
}

/** POST /uploads/presign response. */
export interface PresignResult {
  uploadUrl: string;
  publicUrl: string;
}
