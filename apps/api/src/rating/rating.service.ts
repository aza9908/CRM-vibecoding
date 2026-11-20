import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, eq, gte, inArray, isNull, notIlike, or, sql } from 'drizzle-orm';
import {
  SERVICE_LESSON_CATEGORY,
  STUDENT_RATING_POINTS,
  STUDENT_RATING_TOP,
  type MyStudentRatingResponse,
  type SessionStudentRatingResponse,
  type StudentRatingCategory,
  type StudentRatingMine,
  type StudentRatingPeriod,
  type StudentRatingResponse,
  type StudentRatingRow,
  type StudentRatingTopEntry,
} from '@lms/shared';

import { DRIZZLE, type Db } from '../db/db.module';
import {
  blockBoards,
  lessonBlocks,
  lessons,
  liveSessions,
  participants,
  responses,
  users,
} from '../db/schema';

/** One student's totals before ranking. */
interface StudentTotals {
  key: string;
  name: string;
  nameAt: number;
  points: number;
  lessons: Set<string>;
  answered: Set<string>;
  requiredDone: Set<string>;
  lastActivity: number;
  /** Best stage per status board (blockId → stage index). */
  stages: Map<string, number>;
  /** Highest stage and its title, for display. */
  bestStage: number;
  bestStageTitle: string | null;
}

/** A computed rating: ranked rows plus the lookups needed to find «me». */
interface ComputedRating {
  rows: StudentRatingRow[];
  categories: StudentRatingCategory[];
  /** participant id → student key (only participants that count). */
  keyByParticipant: Map<string, string>;
  /** user id → student key. */
  keyByUser: Map<string, string>;
  /** student key → its row. */
  rowByKey: Map<string, StudentRatingRow>;
}

interface BlockInfo {
  lessonId: string;
  type: string;
  required: boolean;
  /** Checklist items count (a required checklist is done when all are ticked). */
  items: number;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const CACHE_TTL_MS = 30_000;
const CACHE_MAX = 200;

/** Tiny union-find over identity keys (user id ↔ phone of the same row). */
class Identities {
  private parent = new Map<string, string>();

  find(k: string): string {
    let root = k;
    for (;;) {
      const p = this.parent.get(root);
      if (p === undefined) {
        this.parent.set(root, root);
        break;
      }
      if (p === root) break;
      root = p;
    }
    // Path compression.
    let cur = k;
    while (cur !== root) {
      const next = this.parent.get(cur) ?? root;
      this.parent.set(cur, root);
      cur = next;
    }
    return root;
  }

  union(a: string, b: string): void {
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra === rb) return;
    // Prefer an account key as the root so it stays stable.
    if (rb.startsWith('u:')) this.parent.set(ra, rb);
    else this.parent.set(rb, ra);
  }
}

/** Digits of a phone number; too-short values are not an identity. */
function normalizePhone(phone: string | null): string | null {
  const digits = (phone ?? '').replace(/\D+/g, '');
  return digits.length >= 6 ? digits : null;
}

function readOptions(options: unknown): Record<string, unknown> {
  return options && typeof options === 'object' ? (options as Record<string, unknown>) : {};
}

/** Checked indices of a checklist answer (`"[0,2]"`); empty on anything else. */
function checklistCount(answer: string | null): number {
  if (!answer) return 0;
  try {
    const parsed: unknown = JSON.parse(answer);
    return Array.isArray(parsed) ? parsed.length : 0;
  } catch {
    return 0;
  }
}

/** A response counts as «answered» if it says done or carries a real answer. */
function isAnswered(
  block: BlockInfo,
  r: { answerText: string | null; isCompleted: boolean | null },
): boolean {
  if (r.isCompleted) return true;
  if (block.type === 'checklist') return checklistCount(r.answerText) > 0;
  return (r.answerText ?? '').trim().length > 0;
}

/** A required block is «done» once answered; a checklist needs every item. */
function isRequiredDone(
  block: BlockInfo,
  r: { answerText: string | null; isCompleted: boolean | null },
): boolean {
  if (!block.required) return false;
  if (r.isCompleted) return true;
  if (block.type === 'checklist') {
    return block.items > 0 && checklistCount(r.answerText) >= block.items;
  }
  return isAnswered(block, r);
}

/** Competition ranking: equal points share a place (1, 1, 3…). */
/** Name for matching board rows to attendees: lowercase, ё→е, words sorted. */
function nameKey(name: string): string {
  return name
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .sort()
    .join(' ');
}

function rankRows(totals: Iterable<StudentTotals>): {
  rows: StudentRatingRow[];
  rowByKey: Map<string, StudentRatingRow>;
} {
  const sorted = [...totals]
    .filter((s) => s.points > 0)
    .sort((a, b) => b.points - a.points || a.name.localeCompare(b.name, 'ru'));
  const rows: StudentRatingRow[] = [];
  const rowByKey = new Map<string, StudentRatingRow>();
  sorted.forEach((s, i) => {
    const prev = rows[i - 1];
    const row: StudentRatingRow = {
      rank: prev && prev.points === s.points ? prev.rank : i + 1,
      name: s.name,
      points: s.points,
      lessons: s.lessons.size,
      answered: s.answered.size,
      requiredDone: s.requiredDone.size,
      projectStage: s.bestStage >= 0 ? s.bestStage : null,
      projectStageTitle: s.bestStage >= 0 ? s.bestStageTitle : null,
      lastActivity: s.lastActivity > 0 ? new Date(s.lastActivity).toISOString() : null,
    };
    rows.push(row);
    rowByKey.set(s.key, row);
  });
  return { rows, rowByKey };
}

/**
 * Student rating (points for workbook work in live lessons).
 *
 * Everything is computed from the caller's organization only: sessions are
 * selected by `live_sessions.organization_id = orgId` and every participant,
 * response and block is reached through those sessions — nothing from another
 * tenant can enter the result. Service lessons (automatic checks), removed
 * participants and staff accounts never count.
 *
 * A «student» across sessions is the account (user id) when the participant
 * row has one, otherwise the phone number (digits only), otherwise the
 * device key, otherwise the row itself. A user id and a phone seen on the
 * same row are merged, so a person who once joined as a guest and later with
 * their account is one student.
 */
@Injectable()
export class RatingService {
  private cache = new Map<string, { at: number; value: Promise<ComputedRating> }>();

  constructor(@Inject(DRIZZLE) private readonly db: Db) {}

  /** `GET /rating` — staff table. */
  async forStaff(
    orgId: string,
    category: string | undefined,
    period: StudentRatingPeriod,
  ): Promise<StudentRatingResponse> {
    const r = await this.compute(orgId, category ?? null, period);
    return {
      period,
      category: category ?? null,
      categories: r.categories,
      rows: r.rows,
      generatedAt: new Date().toISOString(),
    };
  }

  /** `GET /rating/me` — a student account's standing in their organization. */
  async forStudent(orgId: string, userId: string): Promise<MyStudentRatingResponse> {
    const r = await this.compute(orgId, null, 'all');
    const key = r.keyByUser.get(userId);
    return { me: this.mine(r, key), top: this.top(r) };
  }

  /**
   * `GET /sessions/:id/rating` — the rating of the session's company (lesson
   * category) inside the session's organization. `orgId` is the caller's
   * organization for a user token (the session must belong to it) or null for
   * a participant token already bound to this session.
   */
  async forSession(
    sessionId: string,
    caller: { orgId: string | null; participantId?: string; userId?: string },
  ): Promise<SessionStudentRatingResponse> {
    const [session] = await this.db
      .select({
        organizationId: liveSessions.organizationId,
        category: lessons.category,
      })
      .from(liveSessions)
      .leftJoin(lessons, eq(lessons.id, liveSessions.lessonId))
      .where(eq(liveSessions.id, sessionId))
      .limit(1);
    if (!session || !session.organizationId) throw new NotFoundException('session_not_found');
    // A user may only look at sessions of their own organization; 404 so the
    // existence of another tenant's session is not leaked.
    if (caller.orgId !== null && session.organizationId !== caller.orgId) {
      throw new NotFoundException('session_not_found');
    }
    const category = session.category?.trim() || null;
    const r = await this.compute(session.organizationId, category, 'all');

    let me: StudentRatingMine | null = null;
    if (caller.participantId) {
      me = this.mine(r, r.keyByParticipant.get(caller.participantId));
    } else if (caller.userId) {
      const key = r.keyByUser.get(caller.userId);
      if (key) me = this.mine(r, key);
    }
    return { category, top: this.top(r), me };
  }

  // ── internals ──────────────────────────────────────────────────────────────

  private top(r: ComputedRating): StudentRatingTopEntry[] {
    return r.rows
      .slice(0, STUDENT_RATING_TOP)
      .map(({ rank, name, points }) => ({ rank, name, points }));
  }

  private mine(r: ComputedRating, key: string | undefined): StudentRatingMine {
    const row = key ? r.rowByKey.get(key) : undefined;
    return {
      points: row?.points ?? 0,
      rank: row?.rank ?? null,
      total: r.rows.length,
      lessons: row?.lessons ?? 0,
      answered: row?.answered ?? 0,
      requiredDone: row?.requiredDone ?? 0,
    };
  }

  /**
   * Short-lived cache: the live page polls every minute from every student,
   * and the whole organization is aggregated per call.
   */
  private compute(
    orgId: string,
    category: string | null,
    period: StudentRatingPeriod,
  ): Promise<ComputedRating> {
    const cacheKey = `${orgId}|${period}|${category ?? ''}`;
    const now = Date.now();
    const hit = this.cache.get(cacheKey);
    if (hit && now - hit.at < CACHE_TTL_MS) return hit.value;
    if (this.cache.size >= CACHE_MAX) {
      for (const [k, v] of this.cache) if (now - v.at >= CACHE_TTL_MS) this.cache.delete(k);
      if (this.cache.size >= CACHE_MAX) this.cache.clear();
    }
    const value = this.computeFresh(orgId, category, period);
    this.cache.set(cacheKey, { at: now, value });
    value.catch(() => this.cache.delete(cacheKey));
    return value;
  }

  private async computeFresh(
    orgId: string,
    category: string | null,
    period: StudentRatingPeriod,
  ): Promise<ComputedRating> {
    const empty: ComputedRating = {
      rows: [],
      categories: [],
      keyByParticipant: new Map(),
      keyByUser: new Map(),
      rowByKey: new Map(),
    };
    // A student without a company carries orgId '' — nothing to rank.
    if (!orgId) return empty;
    const since = period === '30d' ? new Date(Date.now() - 30 * DAY_MS) : null;

    // 1. Real classes of this organization (service checks excluded).
    const sessions = await this.db
      .select({
        id: liveSessions.id,
        lessonId: liveSessions.lessonId,
        category: lessons.category,
      })
      .from(liveSessions)
      .innerJoin(lessons, eq(lessons.id, liveSessions.lessonId))
      .where(
        and(
          eq(liveSessions.organizationId, orgId),
          or(isNull(lessons.category), sql`${lessons.category} <> ${SERVICE_LESSON_CATEGORY}`),
          notIlike(lessons.title, '%(авто)%'),
        ),
      );
    if (sessions.length === 0) return empty;

    const lessonOf = new Map<string, string>();
    const categoryOfSession = new Map<string, string | null>();
    for (const s of sessions) {
      if (!s.lessonId) continue;
      lessonOf.set(s.id, s.lessonId);
      categoryOfSession.set(s.id, s.category?.trim() || null);
    }
    const sessionIds = [...lessonOf.keys()];
    const lessonIds = [...new Set(lessonOf.values())];

    // 2. Participants (removed ones never count).
    const parts = await this.db
      .select({
        id: participants.id,
        sessionId: participants.sessionId,
        userId: participants.userId,
        name: participants.name,
        phone: participants.phone,
        clientKey: participants.clientKey,
        createdAt: participants.createdAt,
      })
      .from(participants)
      .where(and(inArray(participants.sessionId, sessionIds), isNull(participants.removedAt)));
    if (parts.length === 0) return empty;

    // Staff who joined their own lesson (to test it) are not students.
    const userIds = [...new Set(parts.map((p) => p.userId).filter((v): v is string => !!v))];
    const staff = new Set<string>();
    if (userIds.length) {
      const rows = await this.db
        .select({ id: users.id, role: users.role })
        .from(users)
        .where(inArray(users.id, userIds));
      for (const u of rows) if (u.role !== 'student') staff.add(u.id);
    }
    const students = parts.filter((p) => !(p.userId && staff.has(p.userId)));

    // 3. Identity: account ↔ phone on the same row are one person.
    const ids = new Identities();
    const rawKey = (p: (typeof students)[number]): string => {
      if (p.userId) return `u:${p.userId}`;
      const phone = normalizePhone(p.phone);
      if (phone) return `p:${phone}`;
      if (p.clientKey) return `k:${p.clientKey}`;
      return `r:${p.id}`;
    };
    for (const p of students) {
      const phone = normalizePhone(p.phone);
      if (p.userId && phone) ids.union(`u:${p.userId}`, `p:${phone}`);
    }
    const keyByParticipant = new Map<string, string>();
    const keyByUser = new Map<string, string>();
    for (const p of students) {
      const key = ids.find(rawKey(p));
      keyByParticipant.set(p.id, key);
      if (p.userId) keyByUser.set(p.userId, key);
    }

    // 4. Blocks of these lessons (which are required, checklist sizes).
    const blockRows = await this.db
      .select({
        id: lessonBlocks.id,
        lessonId: lessonBlocks.lessonId,
        type: lessonBlocks.type,
        options: lessonBlocks.options,
      })
      .from(lessonBlocks)
      .where(inArray(lessonBlocks.lessonId, lessonIds));
    const blocks = new Map<string, BlockInfo>();
    const requiredByLesson = new Map<string, Set<string>>();
    for (const b of blockRows) {
      if (!b.lessonId) continue;
      const o = readOptions(b.options);
      const info: BlockInfo = {
        lessonId: b.lessonId,
        type: b.type,
        required: o.required === true,
        items: Array.isArray(o.items) ? o.items.length : 0,
      };
      blocks.set(b.id, info);
      if (info.required) {
        let set = requiredByLesson.get(b.lessonId);
        if (!set) requiredByLesson.set(b.lessonId, (set = new Set()));
        set.add(b.id);
      }
    }

    // 4b. Project status boards of these lessons: the teacher ticks one
    // stage per named row. A row is matched to a student by name (word order
    // and case ignored) among the people who attended that lesson.
    const boardBlocks = blockRows.filter((b) => b.type === 'status_board' && b.lessonId);
    const boardStates = boardBlocks.length
      ? await this.db
          .select({ blockId: blockBoards.blockId, state: blockBoards.state, updatedAt: blockBoards.updatedAt })
          .from(blockBoards)
          .where(inArray(blockBoards.blockId, boardBlocks.map((b) => b.id)))
      : [];
    const stateByBlock = new Map(boardStates.map((b) => [b.blockId, b]));
    const boards: Array<{
      blockId: string;
      lessonId: string;
      cells: Array<{ name: string; stage: number; title: string | null }>;
      at: number;
    }> = [];
    for (const b of boardBlocks) {
      const st = stateByBlock.get(b.id);
      if (!st) continue;
      if (since && (st.updatedAt?.getTime() ?? 0) < since.getTime()) continue;
      const o = readOptions(b.options) as { rows?: Array<{ label?: unknown }>; columns?: Array<{ title?: unknown; label?: unknown }> };
      const rowsOpt = Array.isArray(o.rows) ? o.rows : [];
      const colsOpt = Array.isArray(o.columns) ? o.columns : [];
      const cells: Array<{ name: string; stage: number; title: string | null }> = [];
      for (const [row, col] of Object.entries((st.state ?? {}) as Record<string, unknown>)) {
        const r = rowsOpt[Number(row)];
        if (!r || typeof r.label !== 'string' || typeof col !== 'number' || col < 0) continue;
        const c = colsOpt[col];
        const title = c && typeof c.title === 'string' ? c.title : c && typeof c.label === 'string' ? c.label : null;
        cells.push({ name: r.label, stage: col, title });
      }
      if (cells.length) boards.push({ blockId: b.id, lessonId: b.lessonId!, cells, at: st.updatedAt?.getTime() ?? 0 });
    }

    // 5. Answers of these participants.
    const studentIds = students.map((p) => p.id);
    const resp = studentIds.length
      ? await this.db
          .select({
            participantId: responses.participantId,
            blockId: responses.blockId,
            answerText: responses.answerText,
            isCompleted: responses.isCompleted,
            updatedAt: responses.updatedAt,
          })
          .from(responses)
          .where(
            since
              ? and(inArray(responses.participantId, studentIds), gte(responses.updatedAt, since))
              : inArray(responses.participantId, studentIds),
          )
      : [];

    // 6. Aggregate per category (for the tiles) and for the requested scope.
    const partById = new Map(students.map((p) => [p.id, p]));
    const aggregate = (inScope: (sessionId: string) => boolean): Map<string, StudentTotals> => {
      const totals = new Map<string, StudentTotals>();
      const get = (key: string): StudentTotals => {
        let t = totals.get(key);
        if (!t) {
          t = {
            key,
            name: '',
            nameAt: -1,
            points: 0,
            lessons: new Set(),
            answered: new Set(),
            requiredDone: new Set(),
            lastActivity: 0,
            stages: new Map(),
            bestStage: -1,
            bestStageTitle: null,
          };
          totals.set(key, t);
        }
        return t;
      };
      const touch = (t: StudentTotals, at: number, name: string) => {
        if (at > t.lastActivity) t.lastActivity = at;
        if (at >= t.nameAt && name.trim()) {
          t.name = name.trim();
          t.nameAt = at;
        }
      };
      for (const p of students) {
        if (!p.sessionId || !inScope(p.sessionId)) continue;
        const joined = p.createdAt?.getTime() ?? 0;
        if (since && joined < since.getTime()) continue;
        const t = get(keyByParticipant.get(p.id)!);
        t.lessons.add(lessonOf.get(p.sessionId)!);
        touch(t, joined, p.name);
      }
      for (const r of resp) {
        if (!r.participantId || !r.blockId) continue;
        const p = partById.get(r.participantId);
        if (!p?.sessionId || !inScope(p.sessionId)) continue;
        const block = blocks.get(r.blockId);
        // The block must belong to the session's own lesson.
        if (!block || block.lessonId !== lessonOf.get(p.sessionId)) continue;
        if (!isAnswered(block, r)) continue;
        const t = get(keyByParticipant.get(p.id)!);
        t.lessons.add(block.lessonId);
        t.answered.add(r.blockId);
        if (isRequiredDone(block, r)) t.requiredDone.add(r.blockId);
        touch(t, r.updatedAt?.getTime() ?? 0, p.name);
      }
      // Project stages: board rows ↔ attendees of that lesson, by name.
      if (boards.length) {
        const byLessonName = new Map<string, Set<string>>();
        for (const p of students) {
          if (!p.sessionId || !inScope(p.sessionId)) continue;
          const lessonId = lessonOf.get(p.sessionId);
          if (!lessonId) continue;
          const k = `${lessonId}|${nameKey(p.name)}`;
          let set = byLessonName.get(k);
          if (!set) byLessonName.set(k, (set = new Set()));
          set.add(keyByParticipant.get(p.id)!);
        }
        for (const board of boards) {
          for (const cell of board.cells) {
            const keys = byLessonName.get(`${board.lessonId}|${nameKey(cell.name)}`);
            // Only an unambiguous match earns the bonus.
            if (!keys || keys.size !== 1) continue;
            const t = get([...keys][0]!);
            const prev = t.stages.get(board.blockId) ?? -1;
            if (cell.stage > prev) t.stages.set(board.blockId, cell.stage);
            if (cell.stage > t.bestStage) {
              t.bestStage = cell.stage;
              t.bestStageTitle = cell.title;
            }
            if (board.at > t.lastActivity) t.lastActivity = board.at;
          }
        }
      }
      for (const t of totals.values()) {
        let points =
          t.lessons.size * STUDENT_RATING_POINTS.lessonAttended +
          t.answered.size * STUDENT_RATING_POINTS.answeredBlock +
          t.requiredDone.size * STUDENT_RATING_POINTS.requiredBlock;
        for (const lessonId of t.lessons) {
          const required = requiredByLesson.get(lessonId);
          if (required && required.size > 0 && [...required].every((id) => t.requiredDone.has(id))) {
            points += STUDENT_RATING_POINTS.allRequiredBonus;
          }
        }
        for (const stage of t.stages.values()) points += stage * STUDENT_RATING_POINTS.projectStage;
        t.points = points;
        if (!t.name) t.name = '—';
      }
      return totals;
    };

    const categoryNames = [
      ...new Set([...categoryOfSession.values()].filter((c): c is string => !!c)),
    ].sort((a, b) => a.localeCompare(b, 'ru'));
    const categories: StudentRatingCategory[] = categoryNames.map((name) => {
      const totals = aggregate((sid) => categoryOfSession.get(sid) === name);
      return {
        name,
        students: [...totals.values()].filter((t) => t.points > 0).length,
      };
    });

    const totals = aggregate((sid) => category === null || categoryOfSession.get(sid) === category);
    const { rows, rowByKey } = rankRows(totals.values());

    return { rows, categories, keyByParticipant, keyByUser, rowByKey };
  }
}
