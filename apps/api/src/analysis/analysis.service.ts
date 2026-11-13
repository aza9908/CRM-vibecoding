import {
  BadRequestException,
  ConflictException,
  HttpException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import {
  ANALYSIS_AUDIO_MAX_BYTES,
  lessonAnalysisReportSchema,
  type FinishAnalysisDto,
  type LessonAnalysis,
  type LessonAnalysisLocale,
  type LessonAnalysisReport,
  type LessonAnalysisStage,
  type LessonAnalysisStatus,
} from '@lms/shared';
import { DRIZZLE, type Db } from '../db/db.module';
import {
  lessonAnalyses,
  lessonBlocks,
  lessons,
  liveSessions,
  participants,
  pulseChecks,
  responses,
  sessionChatMessages,
} from '../db/schema';
import {
  LLM_PROVIDER,
  type ChatMessage,
  type LlmProvider,
  type TranscriptSegment,
} from '../ai/providers/llm-provider.interface';
import { SessionsService } from '../sessions/sessions.service';
import { LessonsService } from '../lessons/lessons.service';
import {
  formatStamp,
  notesMessages,
  repairMessages,
  reportMessages,
  splitIntoWindows,
  transcriptLines,
} from './analysis.prompts';

type AnalysisRow = typeof lessonAnalyses.$inferSelect;

/** Where the audio of recordings in progress is collected. */
const AUDIO_DIR = join(tmpdir(), 'lms-analysis');
/** A whole job (transcription + all LLM calls) may take this long at most. */
const JOB_TIMEOUT_MS = 30 * 60_000;
/** Transcripts shorter than this go to the report call directly (no notes step). */
const DIRECT_TRANSCRIPT_CHARS = 9_000;

interface AudioMeta {
  sessionId: string;
  orgId: string;
  /** Next piece number the server expects. */
  nextSeq: number;
  bytes: number;
  /** Pieces past Whisper's size limit are acknowledged but not stored. */
  truncated: boolean;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * «ИИ-разбор урока»: collects a recording's audio, then runs the analysis
 * job — transcription, lesson context, notes per part of the lesson, final
 * report — and stores the result.
 *
 * Audio pieces and the job queue live on this machine (temp files + memory):
 * the API runs as a single instance. Jobs run one at a time; a job that was
 * running when the API restarted is marked failed at boot.
 */
@Injectable()
export class AnalysisService implements OnModuleInit {
  private readonly logger = new Logger(AnalysisService.name);
  private readonly queue: string[] = [];
  private running = false;
  /** Serialises writes per recording so pieces cannot interleave. */
  private readonly locks = new Map<string, Promise<unknown>>();

  constructor(
    @Inject(DRIZZLE) private readonly db: Db,
    @Inject(LLM_PROVIDER) private readonly llm: LlmProvider,
    private readonly sessions: SessionsService,
    private readonly lessonsService: LessonsService,
  ) {}

  async onModuleInit(): Promise<void> {
    await fs.mkdir(AUDIO_DIR, { recursive: true }).catch(() => undefined);
    // Whatever was queued or running died with the previous process.
    try {
      await this.db
        .update(lessonAnalyses)
        .set({ status: 'failed', error: 'interrupted', finishedAt: new Date() })
        .where(inArray(lessonAnalyses.status, ['queued', 'processing']));
    } catch (err) {
      // The table may not exist yet on a database that is being migrated.
      this.logger.warn(`could not reset unfinished analyses: ${String(err)}`);
    }
  }

  // ── audio pieces ─────────────────────────────────────────────────────────

  private audioPath(recordingId: string): string {
    return join(AUDIO_DIR, `${recordingId}.audio`);
  }
  private metaPath(recordingId: string): string {
    return join(AUDIO_DIR, `${recordingId}.json`);
  }

  private async readMeta(recordingId: string): Promise<AudioMeta | null> {
    try {
      return JSON.parse(await fs.readFile(this.metaPath(recordingId), 'utf8')) as AudioMeta;
    } catch {
      return null;
    }
  }

  private withLock<T>(recordingId: string, run: () => Promise<T>): Promise<T> {
    const prev = this.locks.get(recordingId) ?? Promise.resolve();
    const next = prev.catch(() => undefined).then(run);
    this.locks.set(recordingId, next);
    void next
      .catch(() => undefined)
      .finally(() => {
        if (this.locks.get(recordingId) === next) this.locks.delete(recordingId);
      });
    return next;
  }

  /**
   * Append one piece of a recording's audio. Pieces arrive in order; a piece
   * that was already stored is acknowledged again (the client retries after a
   * network drop), a piece from the future is refused with the number the
   * server is waiting for.
   */
  async appendAudio(
    orgId: string,
    sessionId: string,
    recordingId: string,
    seq: number,
    data: Buffer,
  ): Promise<{ ok: true; nextSeq: number; duplicate?: true; truncated?: true }> {
    await this.sessions.assertSessionInOrg(sessionId, orgId);
    return this.withLock(recordingId, async () => {
      let meta = await this.readMeta(recordingId);
      if (meta && (meta.sessionId !== sessionId || meta.orgId !== orgId)) {
        // Someone else's recording id — do not reveal that it exists.
        throw new NotFoundException('recording_not_found');
      }
      if (!meta) {
        if (seq !== 0) {
          throw new ConflictException({ message: 'gap', nextSeq: 0 });
        }
        meta = { sessionId, orgId, nextSeq: 0, bytes: 0, truncated: false };
        await fs.mkdir(AUDIO_DIR, { recursive: true });
        await fs.writeFile(this.audioPath(recordingId), Buffer.alloc(0));
      }
      if (seq < meta.nextSeq) return { ok: true, nextSeq: meta.nextSeq, duplicate: true };
      if (seq > meta.nextSeq) {
        throw new ConflictException({ message: 'gap', nextSeq: meta.nextSeq });
      }
      if (meta.truncated || meta.bytes + data.length > ANALYSIS_AUDIO_MAX_BYTES) {
        // Past the transcription limit (~2 h 15 min): the analysis covers
        // what fits; later pieces are accepted so the client keeps going.
        meta.truncated = true;
      } else {
        await fs.appendFile(this.audioPath(recordingId), data);
        meta.bytes += data.length;
      }
      meta.nextSeq += 1;
      await fs.writeFile(this.metaPath(recordingId), JSON.stringify(meta));
      return {
        ok: true,
        nextSeq: meta.nextSeq,
        ...(meta.truncated ? { truncated: true as const } : {}),
      };
    });
  }

  private async removeAudio(recordingId: string): Promise<void> {
    await fs.rm(this.audioPath(recordingId), { force: true }).catch(() => undefined);
    await fs.rm(this.metaPath(recordingId), { force: true }).catch(() => undefined);
  }

  // ── rows ─────────────────────────────────────────────────────────────────

  private toDto(row: AnalysisRow, withTranscript = true): LessonAnalysis {
    return {
      id: row.id,
      sessionId: row.sessionId,
      lessonId: row.lessonId,
      status: row.status as LessonAnalysisStatus,
      progress: row.progress,
      stage: row.stage as LessonAnalysisStage,
      title: row.title,
      locale: row.locale as LessonAnalysisLocale,
      durationSec: row.durationSec,
      transcript: withTranscript ? row.transcript : null,
      report: (row.report as LessonAnalysisReport | null) ?? null,
      error: row.error,
      createdAt: row.createdAt.toISOString(),
      finishedAt: row.finishedAt ? row.finishedAt.toISOString() : null,
    };
  }

  /**
   * The recording stopped: create the analysis and queue its job. Calling it
   * again for the same recording returns the existing analysis.
   */
  async finish(orgId: string, sessionId: string, dto: FinishAnalysisDto): Promise<LessonAnalysis> {
    await this.sessions.assertSessionInOrg(sessionId, orgId);
    const existing = await this.db.query.lessonAnalyses.findFirst({
      where: and(
        eq(lessonAnalyses.recordingId, dto.recordingId),
        eq(lessonAnalyses.organizationId, orgId),
      ),
    });
    if (existing) return this.toDto(existing);

    const meta = await this.readMeta(dto.recordingId);
    if (!meta || meta.sessionId !== sessionId || meta.orgId !== orgId) {
      throw new NotFoundException('recording_not_found');
    }
    if (meta.bytes === 0) {
      await this.removeAudio(dto.recordingId);
      throw new BadRequestException('no_audio');
    }
    const session = await this.db.query.liveSessions.findFirst({
      where: eq(liveSessions.id, sessionId),
      columns: { lessonId: true },
    });
    const [row] = await this.db
      .insert(lessonAnalyses)
      .values({
        sessionId,
        lessonId: session?.lessonId ?? null,
        organizationId: orgId,
        recordingId: dto.recordingId,
        title: dto.title,
        locale: dto.locale,
        durationSec: dto.durationSec ?? null,
      })
      .onConflictDoNothing()
      .returning();
    if (!row) {
      // Lost a race with a second `finish` for the same recording.
      const again = await this.db.query.lessonAnalyses.findFirst({
        where: eq(lessonAnalyses.recordingId, dto.recordingId),
      });
      if (!again || again.organizationId !== orgId) throw new NotFoundException('recording_not_found');
      return this.toDto(again);
    }
    this.enqueue(row.id, dto.mimeType ?? 'audio/webm');
    return this.toDto(row);
  }

  /** Latest analysis of a session, or null. Scoped to the caller's org. */
  async latestForSession(orgId: string, sessionId: string): Promise<LessonAnalysis | null> {
    await this.sessions.assertSessionInOrg(sessionId, orgId);
    const row = await this.db.query.lessonAnalyses.findFirst({
      where: and(
        eq(lessonAnalyses.sessionId, sessionId),
        eq(lessonAnalyses.organizationId, orgId),
      ),
      orderBy: desc(lessonAnalyses.createdAt),
    });
    return row ? this.toDto(row) : null;
  }

  /** Every analysis of a lesson, newest first (without transcripts). */
  async listForLesson(orgId: string, lessonId: string): Promise<LessonAnalysis[]> {
    await this.lessonsService.assertLessonInOrg(lessonId, orgId);
    const rows = await this.db
      .select()
      .from(lessonAnalyses)
      .where(
        and(eq(lessonAnalyses.lessonId, lessonId), eq(lessonAnalyses.organizationId, orgId)),
      )
      .orderBy(desc(lessonAnalyses.createdAt))
      .limit(50);
    return rows.map((r) => this.toDto(r, false));
  }

  // ── job queue ────────────────────────────────────────────────────────────

  private readonly mimeById = new Map<string, string>();

  private enqueue(id: string, mimeType: string): void {
    this.mimeById.set(id, mimeType);
    this.queue.push(id);
    void this.pump();
  }

  private async pump(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      for (let id = this.queue.shift(); id; id = this.queue.shift()) {
        await this.runJob(id).catch((err) =>
          this.logger.error(`analysis ${id} crashed: ${err instanceof Error ? err.stack : String(err)}`),
        );
        this.mimeById.delete(id);
      }
    } finally {
      this.running = false;
    }
  }

  private async setProgress(
    id: string,
    progress: number,
    stage: LessonAnalysisStage,
    extra: Partial<typeof lessonAnalyses.$inferInsert> = {},
  ): Promise<void> {
    await this.db
      .update(lessonAnalyses)
      .set({ progress: Math.round(progress), stage, ...extra })
      .where(eq(lessonAnalyses.id, id));
  }

  private async fail(id: string, error: string): Promise<void> {
    this.logger.warn(`analysis ${id} failed: ${error}`);
    await this.db
      .update(lessonAnalyses)
      .set({ status: 'failed', error: error.slice(0, 300), finishedAt: new Date() })
      .where(eq(lessonAnalyses.id, id));
  }

  private async runJob(id: string): Promise<void> {
    const row = await this.db.query.lessonAnalyses.findFirst({
      where: eq(lessonAnalyses.id, id),
    });
    if (!row) return;
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), JOB_TIMEOUT_MS);
    try {
      await this.setProgress(id, 5, 'transcribing', { status: 'processing' });

      // 1. Speech → timed transcript.
      const audio = await fs.readFile(this.audioPath(row.recordingId)).catch(() => null);
      if (!audio || audio.length === 0) return await this.fail(id, 'no_audio');
      if (audio.length > ANALYSIS_AUDIO_MAX_BYTES) return await this.fail(id, 'audio_too_large');
      const mimeType = this.mimeById.get(id) ?? 'audio/webm';
      const ext = /mp4|m4a|aac/.test(mimeType) ? 'm4a' : /ogg/.test(mimeType) ? 'ogg' : 'webm';
      const heard = await this.withRetry(
        () =>
          this.llm.transcribe({
            audio,
            fileName: `lesson.${ext}`,
            mimeType: mimeType.split(';')[0] || 'audio/webm',
            signal: abort.signal,
          }),
        abort.signal,
      );
      const segments = this.cleanSegments(heard.segments, heard.text);
      const transcript = transcriptLines(segments).join('\n');
      if (transcript.replace(/\[[\d:]+\]/g, '').trim().length < 20) {
        return await this.fail(id, 'no_speech');
      }
      const durationSec =
        heard.durationSec ?? row.durationSec ?? Math.round(segments.at(-1)?.end ?? 0);
      await this.setProgress(id, 40, 'context', { transcript, durationSec });

      // 2. What the LMS knows about this lesson.
      const context = await this.lessonContext(row.sessionId);
      await this.setProgress(id, 45, 'notes');

      // 3. Notes per part of the lesson (skipped for a short recording).
      let material = transcript;
      let materialKind: 'notes' | 'transcript' = 'transcript';
      if (transcript.length > DIRECT_TRANSCRIPT_CHARS) {
        const windows = splitIntoWindows(segments);
        const notes: string[] = [];
        for (let i = 0; i < windows.length; i++) {
          const w = windows[i]!;
          const raw = await this.withRetry(
            () =>
              this.llm.complete(notesMessages(w, row.title), {
                temperature: 0.1,
                maxTokens: 900,
                signal: abort.signal,
              }),
            abort.signal,
          );
          const parsed = this.extractJson(raw);
          notes.push(
            `PART ${i + 1} (${formatStamp(w.from)}–${formatStamp(w.to)}): ${
              parsed ? JSON.stringify(parsed) : raw.trim().slice(0, 1_500)
            }`,
          );
          await this.setProgress(id, 45 + (40 * (i + 1)) / windows.length, 'notes');
        }
        material = notes.join('\n\n');
        materialKind = 'notes';
      }
      await this.setProgress(id, 88, 'report');

      // 4. The review itself, as validated JSON (one repair attempt).
      const messages = reportMessages({
        locale: row.locale as LessonAnalysisLocale,
        lessonTitle: context.lessonTitle ?? row.title,
        durationSec,
        context: context.text,
        material,
        materialKind,
      });
      const report = await this.askForReport(messages, abort.signal);
      if (!report) return await this.fail(id, 'bad_report');

      await this.db
        .update(lessonAnalyses)
        .set({
          status: 'done',
          progress: 100,
          stage: 'done',
          report,
          error: null,
          finishedAt: new Date(),
        })
        .where(eq(lessonAnalyses.id, id));
    } catch (err) {
      const status = (err as { status?: number })?.status;
      const reason = abort.signal.aborted
        ? 'timeout'
        : status === 401 || status === 403
          ? 'llm_unauthorized'
          : status === 413
            ? 'audio_too_large'
            : status === 429
              ? 'llm_rate_limited'
              : status === 503
                ? 'llm_unavailable'
                : `llm_error${status ? `_${status}` : ''}`;
      this.logger.error(`analysis ${id}: ${err instanceof Error ? err.message : String(err)}`);
      await this.fail(id, reason);
    } finally {
      clearTimeout(timer);
      await this.removeAudio(row.recordingId);
    }
  }

  /** Retry rate limits and server errors, honouring `retry-after`. */
  private async withRetry<T>(run: () => Promise<T>, signal: AbortSignal): Promise<T> {
    let lastError: unknown;
    for (let attempt = 0; attempt < 6; attempt++) {
      if (signal.aborted) throw new Error('aborted');
      try {
        return await run();
      } catch (err) {
        lastError = err;
        // Our own provider saying "not configured" is final.
        if (err instanceof HttpException) throw err;
        const e = err as { status?: number; headers?: Record<string, string> | Headers };
        const status = e?.status;
        const network =
          status === undefined && /connection|network|fetch|socket|ECONN|timeout/i.test(String(err));
        if (!(status === 429 || (typeof status === 'number' && status >= 500) || network)) {
          throw err;
        }
        const header =
          e.headers instanceof Headers ? e.headers.get('retry-after') : e.headers?.['retry-after'];
        const wait = Number(header);
        const ms = Number.isFinite(wait) && wait > 0 ? Math.min(wait, 90) * 1000 : 2_000 * 2 ** attempt;
        await sleep(Math.min(ms, 90_000));
      }
    }
    throw lastError;
  }

  /** Fall back to one segment when the vendor returned text without timing. */
  private cleanSegments(segments: TranscriptSegment[], text: string): TranscriptSegment[] {
    const clean = segments.filter((s) => s.text.trim().length > 0);
    if (clean.length > 0) return clean;
    return text.trim() ? [{ start: 0, end: 0, text: text.trim() }] : [];
  }

  private extractJson(raw: string): unknown | null {
    const text = raw.replace(/```(?:json)?/gi, '').trim();
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start < 0 || end <= start) return null;
    try {
      return JSON.parse(text.slice(start, end + 1));
    } catch {
      return null;
    }
  }

  /**
   * Bring a model answer within the schema's hard limits before validating:
   * clamp scores, cut over-long lists, drop malformed timestamps. Missing or
   * wrong-typed fields are still rejected by zod.
   */
  private tidyReport(input: unknown): unknown {
    if (!input || typeof input !== 'object') return input;
    const r = { ...(input as Record<string, unknown>) };
    const stamp = (v: unknown) =>
      typeof v === 'string' && /^(\d{1,2}:)?\d{1,3}:\d{2}$/.test(v.trim()) ? v.trim() : undefined;
    const cut = (v: unknown, n: number) => (typeof v === 'string' ? v.trim().slice(0, n) : v);
    const list = (v: unknown, max: number) => (Array.isArray(v) ? v.slice(0, max) : []);

    if (r.score && typeof r.score === 'object') {
      const s = { ...(r.score as Record<string, unknown>) };
      for (const k of Object.keys(s)) {
        const n = Number(s[k]);
        if (Number.isFinite(n)) s[k] = Math.min(10, Math.max(1, Math.round(n * 10) / 10));
      }
      r.score = s;
    }
    r.summary = cut(r.summary, 2000);
    const items = (v: unknown, max: number) =>
      list(v, max)
        .filter((x): x is Record<string, unknown> => !!x && typeof x === 'object')
        .map((x) => {
          const o: Record<string, unknown> = {
            ...x,
            title: cut(x.title, 200),
            evidence: cut(x.evidence, 600),
          };
          if ('fix' in x) o.fix = cut(x.fix, 600);
          const at = stamp(x.at);
          if (at) o.at = at;
          else delete o.at;
          return o;
        });
    r.strengths = items(r.strengths, 8);
    r.weaknesses = items(r.weaknesses, 8);
    r.timeline = list(r.timeline, 24)
      .filter((x): x is Record<string, unknown> => !!x && typeof x === 'object')
      .filter((x) => stamp(x.from) && stamp(x.to))
      .map((x) => {
        const o: Record<string, unknown> = {
          from: stamp(x.from),
          to: stamp(x.to),
          topic: cut(x.topic, 200),
        };
        if (typeof x.note === 'string' && x.note.trim()) o.note = cut(x.note, 400);
        return o;
      });
    r.recommendations = list(r.recommendations, 5)
      .filter((x) => typeof x === 'string' && x.trim())
      .map((x) => cut(x, 400));
    if (Array.isArray(r.quotes)) {
      r.quotes = r.quotes
        .filter((x): x is Record<string, unknown> => !!x && typeof x === 'object')
        .filter((x) => stamp(x.at) && typeof x.text === 'string' && x.text.trim())
        .slice(0, 8)
        .map((x) => ({ at: stamp(x.at), text: cut(x.text, 400) }));
    } else {
      delete r.quotes;
    }
    if (r.engagement && typeof r.engagement === 'object') {
      const e = { ...(r.engagement as Record<string, unknown>) };
      const share = Number(e.teacherTalkShare);
      if (Number.isFinite(share)) e.teacherTalkShare = Math.min(100, Math.max(0, Math.round(share)));
      else delete e.teacherTalkShare;
      const q = Number(e.studentQuestions);
      e.studentQuestions = Number.isFinite(q) ? Math.max(0, Math.round(q)) : 0;
      if (typeof e.pulse === 'string' && e.pulse.trim()) e.pulse = cut(e.pulse, 400);
      else delete e.pulse;
      if (Array.isArray(e.passive)) {
        e.passive = e.passive
          .filter((x) => typeof x === 'string' && x.trim())
          .slice(0, 50)
          .map((x) => cut(x, 120));
      } else {
        delete e.passive;
      }
      r.engagement = e;
    }
    return r;
  }

  private async askForReport(
    messages: ChatMessage[],
    signal: AbortSignal,
  ): Promise<LessonAnalysisReport | null> {
    let current = messages;
    for (let attempt = 0; attempt < 2; attempt++) {
      const raw = await this.withRetry(
        () => this.llm.complete(current, { temperature: 0.2, maxTokens: 3_500, signal }),
        signal,
      );
      const json = this.extractJson(raw);
      const parsed = lessonAnalysisReportSchema.safeParse(this.tidyReport(json));
      if (parsed.success) return parsed.data;
      const problem = json
        ? parsed.error.issues
            .slice(0, 6)
            .map((i) => `${i.path.join('.')}: ${i.message}`)
            .join('; ')
        : 'it was not a JSON object';
      this.logger.warn(`analysis report rejected (attempt ${attempt + 1}): ${problem}`);
      current = repairMessages(messages, raw, problem);
    }
    return null;
  }

  // ── lesson context ───────────────────────────────────────────────────────

  /** A compact text digest of what the LMS recorded about the session. */
  private async lessonContext(
    sessionId: string,
  ): Promise<{ lessonTitle: string | null; text: string }> {
    const lines: string[] = [];
    let lessonTitle: string | null = null;
    try {
      const session = await this.db.query.liveSessions.findFirst({
        where: eq(liveSessions.id, sessionId),
        columns: { lessonId: true },
      });
      const people = await this.db
        .select({ id: participants.id })
        .from(participants)
        .where(eq(participants.sessionId, sessionId));
      lines.push(`Participants who joined the session: ${people.length}`);

      if (session?.lessonId) {
        const lesson = await this.db.query.lessons.findFirst({
          where: eq(lessons.id, session.lessonId),
          columns: { title: true },
        });
        lessonTitle = lesson?.title ?? null;
        const blocks = await this.db
          .select({
            id: lessonBlocks.id,
            type: lessonBlocks.type,
            content: lessonBlocks.content,
          })
          .from(lessonBlocks)
          .where(eq(lessonBlocks.lessonId, session.lessonId))
          .orderBy(asc(lessonBlocks.orderIndex))
          .limit(120);
        // Completed answers per exercise, for this session's participants.
        const done =
          people.length > 0
            ? await this.db
                .select({
                  blockId: responses.blockId,
                  n: sql<number>`count(*)::int`,
                })
                .from(responses)
                .where(
                  and(
                    inArray(
                      responses.participantId,
                      people.map((p) => p.id),
                    ),
                    eq(responses.isCompleted, true),
                  ),
                )
                .groupBy(responses.blockId)
            : [];
        const doneBy = new Map(done.map((d) => [d.blockId, d.n]));
        const outline = blocks
          .map((b) => {
            const head = (b.content ?? '')
              .replace(/[#*_`>]/g, '')
              .split('\n')
              .map((l) => l.trim())
              .find((l) => l.length > 0);
            const isTask = b.type !== 'text' && b.type !== 'image';
            if (!head && !isTask) return null;
            const answered = isTask ? ` — answered by ${doneBy.get(b.id) ?? 0}/${people.length}` : '';
            return `- [${b.type}] ${(head ?? '').slice(0, 90)}${answered}`;
          })
          .filter((l): l is string => !!l)
          .slice(0, 60);
        if (outline.length) lines.push('Workbook outline (blocks of the lesson):', ...outline);
      }

      const pulses = await this.db
        .select()
        .from(pulseChecks)
        .where(eq(pulseChecks.sessionId, sessionId))
        .orderBy(asc(pulseChecks.startedAt))
        .limit(20);
      if (pulses.length) {
        lines.push('«Пульс класса» checks (teacher asked if everything is clear):');
        for (const p of pulses) {
          const silent = (p.pending as { name?: string }[])
            .map((x) => x.name)
            .filter(Boolean)
            .slice(0, 15)
            .join(', ');
          lines.push(
            `- "${p.question.slice(0, 100)}": understanding ${p.understanding}%, answered ${p.answered}/${p.eligible}${silent ? `, silent: ${silent}` : ''}`,
          );
        }
      }

      const chat = await this.db
        .select({
          role: sessionChatMessages.role,
          text: sessionChatMessages.text,
        })
        .from(sessionChatMessages)
        .where(eq(sessionChatMessages.sessionId, sessionId))
        .orderBy(desc(sessionChatMessages.createdAt))
        .limit(40);
      if (chat.length) {
        lines.push('Group chat during the lesson (latest messages):');
        for (const m of chat.reverse()) {
          lines.push(`- ${m.role === 'teacher' ? 'teacher' : 'student'}: ${m.text.slice(0, 160)}`);
        }
      }
    } catch (err) {
      // Context is a bonus — the transcript alone is enough for a review.
      this.logger.warn(`lesson context unavailable: ${String(err)}`);
    }
    return { lessonTitle, text: lines.join('\n').slice(0, 6_000) };
  }
}
