'use client';

import * as React from 'react';
import { useParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useSession, useMyResponses } from '@/lib/api/hooks/use-sessions';
import {
  useLiveChatActions,
  useSaveSessionResponse,
  useUploadResponseFile,
  useResponseFileUrl,
} from '@/lib/api/hooks/use-live-rest';
import { useUpdateProgress } from '@/lib/api/hooks/use-progress';
import { useSessionSocket } from '@/lib/ws/useSessionSocket';
import { useAuthStore } from '@/lib/store/auth-store';
import { useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '@/lib/api/query-keys';
import type { Block } from '@/lib/api/types';
import { isInputBlock } from '@/lib/blocks';
import { progressPercent } from '@/lib/progress';
import { WorkbookBlock } from '@/components/live/WorkbookBlock';
import { SlideDeck } from '@/components/live/SlideDeck';
import { RightPanel } from '@/components/live/RightPanel';
import { SessionMetricsPanel } from '@/components/live/SessionMetricsPanel';
import { Brand } from '@/components/brand';
import { ConnectionBadge } from '@/components/live/ConnectionBadge';
import { SessionStateBanner } from '@/components/live/SessionStateBanner';
import { SessionCelebration } from '@/components/live/SessionCelebration';
import { Spinner } from '@/components/ui/spinner';
import { Button } from '@/components/ui/button';
import { ArrowDown, ArrowUp, Maximize2 } from 'lucide-react';
import { ApiError } from '@/lib/api/client';

/** Debounce window for persisting the lesson-summary progress percent. */
const PROGRESS_SYNC_MS = 2000;

/**
 * /live/[sessionId] — the student workbook.
 *
 * - Connects to /live with the participant token; emits session:join.
 * - Renders the lesson blocks; the teacher's focused block is highlighted and
 *   can be jumped to on demand (focus:changed).
 * - Input blocks update local answer state and push debounced response:save.
 * - The right panel hosts Navigation (block progress) · Materials · Notes · AI.
 * - For authenticated students, the lesson-summary percent is persisted
 *   (debounced) to lesson_progress; guests are intentionally not tracked.
 */
export default function StudentLivePage() {
  const params = useParams<{ sessionId: string }>();
  const sessionId = params?.sessionId;
  const t = useTranslations('live');
  const tc = useTranslations('common');

  const participantToken = useAuthStore((s) => s.participantToken);
  const user = useAuthStore((s) => s.user);
  const isAuthedUser = !!user;

  // A logged-in user opening this page without ever having gone through
  // /join (e.g. reviewing a past lesson from "Мои уроки", which links here
  // directly with no join code) has no participant token for THIS session —
  // use their own user token instead, which both endpoints accept just as
  // well. But `/join` deliberately has no org restriction (a user can join
  // a live session hosted by a different org via a code), so an authed user
  // who DID join this exact session still needs their participant token —
  // switching them to the user token would 403 on `assertSessionInOrg`.
  // Decode the (session-scoped) participant token's own `sessionId` claim
  // and only prefer it when it actually matches the session being viewed;
  // a guest has no other credential, so always uses it regardless.
  const participantTokenSessionId = React.useMemo(() => {
    if (!participantToken) return null;
    try {
      const b64 = participantToken.split('.')[1] ?? '';
      const payload = JSON.parse(
        atob(b64.replace(/-/g, '+').replace(/_/g, '/')),
      ) as { sessionId?: string };
      return payload.sessionId ?? null;
    } catch {
      return null;
    }
  }, [participantToken]);
  const useParticipantToken =
    !isAuthedUser || participantTokenSessionId === sessionId;

  // Poll focus/status lightly — full blocks stay cached; WS carries focus/chat.
  const sessionQuery = useSession(sessionId, {
    participant: useParticipantToken,
    pollMs: 8_000,
  });
  const myResponsesQuery = useMyResponses(sessionId, {
    participant: useParticipantToken,
  });

  const {
    status,
    focusedBlockId: wsFocus,
    saveResponse,
    ended,
  } = useSessionSocket(sessionId, { token: participantToken, debounceMs: 150 });

  const saveRest = useSaveSessionResponse(sessionId);
  const uploadFile = useUploadResponseFile(sessionId);
  const resolveFileUrl = useResponseFileUrl(sessionId, { asParticipant: true });
  const qc = useQueryClient();
  const { messages: chatMessages, sendChat } = useLiveChatActions(sessionId, {
    participant: true,
  });

  const [slideDeckOpen, setSlideDeckOpen] = React.useState(false);

  // WS focus with REST poll fallback (session.focusedBlockId).
  const focusedBlockId =
    wsFocus ?? sessionQuery.data?.focusedBlockId ?? null;

  const chatSelfId = React.useMemo(() => {
    const token = participantToken ?? null;
    if (!token) return null;
    try {
      const b64 = token.split('.')[1] ?? '';
      const payload = JSON.parse(
        atob(b64.replace(/-/g, '+').replace(/_/g, '/')),
      ) as { sub?: string };
      return payload.sub ?? null;
    } catch {
      return null;
    }
  }, [participantToken]);

  const blocks: Block[] = sessionQuery.data?.blocks ?? [];
  const lessonId = sessionQuery.data?.lessonId;

  // Local answer state per block, mirrored to the server via saveResponse.
  const [answers, setAnswers] = React.useState<Record<string, string>>({});
  // The block the student last interacted with (drives the "active" nav state).
  const [activeBlockId, setActiveBlockId] = React.useState<string | null>(null);
  const blockRefs = React.useRef<Map<string, HTMLDivElement | null>>(new Map());
  // When the teacher's focused block is off-screen, hint its direction so the
  // student can jump to it on demand — we intentionally do NOT auto-scroll.
  const [focusHint, setFocusHint] = React.useState<null | 'up' | 'down'>(null);
  const restDebounce = React.useRef<Map<string, ReturnType<typeof setTimeout>>>(
    new Map(),
  );

  // Hydrate textareas after reload so students don't lose typed answers.
  React.useEffect(() => {
    const rows = myResponsesQuery.data;
    if (!rows?.length) return;
    setAnswers((prev) => {
      const next = { ...prev };
      let changed = false;
      for (const r of rows) {
        if (!r.blockId || !r.answerText?.trim()) continue;
        if (next[r.blockId] === undefined) {
          next[r.blockId] = r.answerText;
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [myResponsesQuery.data]);

  // "Answered" = blocks with a server-seeded response OR a non-empty local
  // answer. Seeded once from GET /sessions/:id/my-responses, then grown locally.
  const answered = React.useMemo(() => {
    const set = new Set<string>();
    for (const r of myResponsesQuery.data ?? []) {
      if (r.answerText && r.answerText.trim().length > 0) set.add(r.blockId);
    }
    for (const [blockId, text] of Object.entries(answers)) {
      if (text.trim().length > 0) set.add(blockId);
    }
    return set;
  }, [myResponsesQuery.data, answers]);

  const percent = React.useMemo(
    () => progressPercent(blocks, answered),
    [blocks, answered],
  );

  // Explicit mark-complete set (fullscreen slide checkmark), seeded from the
  // server's isCompleted flag and grown locally after a successful mark.
  const [locallyCompleted, setLocallyCompleted] = React.useState<Set<string>>(
    new Set(),
  );
  const completed = React.useMemo(() => {
    const set = new Set(locallyCompleted);
    for (const r of myResponsesQuery.data ?? []) {
      if (r.isCompleted) set.add(r.blockId);
    }
    return set;
  }, [myResponsesQuery.data, locallyCompleted]);

  const handleMarkComplete = React.useCallback(
    (blockId: string) => {
      setLocallyCompleted((prev) => new Set(prev).add(blockId));
      const currentAnswer = answers[blockId] ?? '';
      // `handleFileUpload` seeds `answers[blockId]` with a local `file:`
      // placeholder (the real storage key only ever lives server-side —
      // download resolves it by (participantId, blockId), never by parsing
      // this value). Re-saving that placeholder as `answerText` here would
      // overwrite the real `file:<key>` the upload endpoint already
      // persisted, breaking every future download of that submission. The
      // upload endpoint already sets `completed: true` server-side, so
      // there is nothing left to persist for a file answer — just reflect
      // it as complete locally.
      if (currentAnswer.startsWith('file:')) return;
      saveRest.mutate(
        { blockId, answerText: currentAnswer, completed: true },
        {
          onSuccess: () => {
            if (sessionId) {
              void qc.invalidateQueries({
                queryKey: queryKeys.myResponses(sessionId),
              });
            }
          },
        },
      );
    },
    [answers, saveRest, sessionId, qc],
  );

  const handleFileUpload = React.useCallback(
    async (blockId: string, file: File) => {
      await uploadFile.mutateAsync({ blockId, file });
      setAnswers((prev) => ({ ...prev, [blockId]: `file:${blockId}` }));
      setLocallyCompleted((prev) => new Set(prev).add(blockId));
      if (sessionId) {
        await qc.invalidateQueries({
          queryKey: queryKeys.myResponses(sessionId),
        });
      }
    },
    [uploadFile, sessionId, qc],
  );

  const handleResolveFileUrl = React.useCallback(
    async (blockId: string) => {
      const participantId = chatSelfId ?? '';
      const { url } = await resolveFileUrl.mutateAsync({
        participantId,
        blockId,
      });
      return url;
    },
    [resolveFileUrl, chatSelfId],
  );

  const queueRestSave = React.useCallback(
    (blockId: string, answerText: string, immediate = false) => {
      const timers = restDebounce.current;
      const existing = timers.get(blockId);
      if (existing) clearTimeout(existing);
      if (immediate) {
        timers.delete(blockId);
        saveRest.mutate({ blockId, answerText });
        return;
      }
      const t = setTimeout(() => {
        saveRest.mutate({ blockId, answerText });
        timers.delete(blockId);
      }, 350);
      timers.set(blockId, t);
    },
    [saveRest],
  );

  const handleAnswer = React.useCallback(
    (blockId: string, answerText: string) => {
      setAnswers((prev) => ({ ...prev, [blockId]: answerText }));
      setActiveBlockId(blockId);
      saveResponse(blockId, answerText);
      // Debounced REST — avoids per-keystroke storms with 15+ students.
      queueRestSave(blockId, answerText);
    },
    [saveResponse, queueRestSave],
  );

  const handleSubmit = React.useCallback(
    (blockId: string, answerText: string) => {
      setAnswers((prev) => ({ ...prev, [blockId]: answerText }));
      setActiveBlockId(blockId);
      saveResponse(blockId, answerText);
      queueRestSave(blockId, answerText, true);
    },
    [saveResponse, queueRestSave],
  );

  const scrollToBlock = React.useCallback((blockId: string) => {
    const el = blockRefs.current.get(blockId);
    el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, []);

  const scrollToFocused = React.useCallback(() => {
    if (focusedBlockId) scrollToBlock(focusedBlockId);
  }, [focusedBlockId, scrollToBlock]);

  // ── Progress persistence (authenticated students only; guests skip) ───────
  const updateProgress = useUpdateProgress(lessonId);
  const updateProgressRef = React.useRef(updateProgress);
  updateProgressRef.current = updateProgress;
  const progressTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSentPercent = React.useRef<number | null>(null);

  // On enter: mark the lesson in progress (debounced send shares the same path).
  React.useEffect(() => {
    if (!isAuthedUser || !lessonId) return;
    lastSentPercent.current = null; // re-arm for a fresh lesson
  }, [isAuthedUser, lessonId]);

  // Debounced sync as the percent changes; immediate flush at 100%.
  React.useEffect(() => {
    if (!isAuthedUser || !lessonId) return;
    if (lastSentPercent.current === percent) return;

    const send = () => {
      lastSentPercent.current = percent;
      updateProgressRef.current.mutate(percent);
    };

    if (progressTimer.current) clearTimeout(progressTimer.current);
    if (percent >= 100) {
      send(); // don't delay completion
    } else {
      progressTimer.current = setTimeout(send, PROGRESS_SYNC_MS);
    }

    return () => {
      if (progressTimer.current) clearTimeout(progressTimer.current);
    };
  }, [percent, isAuthedUser, lessonId]);

  // Soft-scroll to the teacher's focus so students land on the right block.
  // Jump hint still appears if they scroll away afterward.
  React.useEffect(() => {
    if (!focusedBlockId) return;
    const timer = window.setTimeout(() => {
      const el = blockRefs.current.get(focusedBlockId);
      el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 80);
    return () => window.clearTimeout(timer);
  }, [focusedBlockId]);

  // Watch whether the focused block is in view. If it leaves the viewport,
  // show a jump button pointing up or down toward it.
  React.useEffect(() => {
    setFocusHint(null);
    if (!focusedBlockId) return;
    const el = blockRefs.current.get(focusedBlockId);
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry) return;
        setFocusHint(
          entry.isIntersecting
            ? null
            : entry.boundingClientRect.top < 0
              ? 'up'
              : 'down',
        );
      },
      { threshold: 0.15 },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [focusedBlockId, blocks]);

  const focusedBlock = React.useMemo(
    () => blocks.find((b) => b.id === focusedBlockId) ?? null,
    [blocks, focusedBlockId],
  );

  // Loading / error / ended states.
  if (sessionQuery.isLoading && !sessionQuery.data) {
    return (
      <main className="container flex min-h-screen items-center justify-center">
        <Spinner className="h-6 w-6" label={tc('loading')} />
      </main>
    );
  }

  const isEndedSession = ended || sessionQuery.data?.status === 'ended';

  // Only kick on a hard 404 with no cached session — never on transient
  // network / cold-start errors (critical for a 15-person live room).
  const hard404 =
    !sessionQuery.data &&
    sessionQuery.isError &&
    sessionQuery.error instanceof ApiError &&
    sessionQuery.error.status === 404;

  if (hard404) {
    return <SessionStateBanner kind="notFound" />;
  }
  if (!sessionQuery.data) {
    return (
      <main className="container flex min-h-screen flex-col items-center justify-center gap-3">
        <Spinner className="h-6 w-6" label={tc('loading')} />
        <p className="text-sm text-muted-foreground">{t('reconnecting')}</p>
      </main>
    );
  }
  if (isEndedSession) {
    return <SessionCelebration />;
  }

  const aiTaskContext = focusedBlock
    ? answers[focusedBlock.id] ?? ''
    : undefined;

  return (
    <main className="container flex min-h-screen flex-col gap-4 py-6">
      <header className="flex items-center justify-between gap-4">
        <div className="flex flex-col gap-1">
          <Brand size="sm" />
          <h1 className="text-xl font-semibold">{t('title')}</h1>
          {!focusedBlockId && (
            <p className="text-sm text-muted-foreground">
              {t('waitingForTeacher')}
            </p>
          )}
        </div>
        <div className="flex items-center gap-2">
          {blocks.length > 0 ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setSlideDeckOpen(true)}
            >
              <Maximize2 className="h-4 w-4" />
              {t('fullscreenMode')}
            </Button>
          ) : null}
          <ConnectionBadge status={status} />
        </div>
      </header>

      <div className="grid flex-1 gap-6 lg:grid-cols-[1fr_360px]">
        {/* Workbook — single centered reading column */}
        <section className="mx-auto w-full max-w-3xl space-y-4">
          {blocks.length === 0 && (
            <p className="text-sm text-muted-foreground">{tc('empty')}</p>
          )}
          {blocks.map((block) => (
            <WorkbookBlock
              key={block.id}
              ref={(el) => {
                blockRefs.current.set(block.id, el);
              }}
              block={block}
              focused={block.id === focusedBlockId}
              value={isInputBlock(block.type) ? answers[block.id] ?? '' : ''}
              onAnswerChange={handleAnswer}
              onAnswerSubmit={handleSubmit}
              onFileUpload={handleFileUpload}
              onResolveFileUrl={handleResolveFileUrl}
            />
          ))}
        </section>

        {/* Right panel — Navigation · Chat · Materials · Notes · AI · Metrics */}
        <aside className="space-y-4 lg:sticky lg:top-6 lg:h-[calc(100vh-3rem)] lg:overflow-y-auto">
          <div className="rounded-lg border bg-card p-4">
            <SessionMetricsPanel sessionId={sessionId!} participant />
          </div>
          <RightPanel
            lessonId={lessonId}
            blocks={blocks}
            answered={answered}
            focusedBlockId={focusedBlockId}
            activeBlockId={activeBlockId}
            percent={percent}
            onSelectBlock={scrollToBlock}
            blockContent={focusedBlock?.content ?? undefined}
            taskContext={aiTaskContext}
            chatMessages={chatMessages}
            onSendChat={sendChat}
            chatSelfId={chatSelfId}
            className="h-auto min-h-[24rem]"
          />
        </aside>
      </div>

      {focusedBlock && focusHint && (
        <Button
          type="button"
          onClick={scrollToFocused}
          className="fixed bottom-6 left-1/2 z-50 -translate-x-1/2 gap-2 shadow-lg"
        >
          {focusHint === 'up' ? <ArrowUp /> : <ArrowDown />}
          {t('goToFocused')}
        </Button>
      )}

      {slideDeckOpen ? (
        <SlideDeck
          blocks={blocks}
          initialBlockId={focusedBlockId}
          answers={answers}
          completed={completed}
          onAnswerChange={handleAnswer}
          onAnswerSubmit={handleSubmit}
          onMarkComplete={handleMarkComplete}
          onFileUpload={handleFileUpload}
          onResolveFileUrl={handleResolveFileUrl}
          onClose={() => setSlideDeckOpen(false)}
        />
      ) : null}
    </main>
  );
}
