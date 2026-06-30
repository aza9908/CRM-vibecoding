'use client';

import * as React from 'react';
import { useParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useSession, useMyResponses } from '@/lib/api/hooks/use-sessions';
import { useUpdateProgress } from '@/lib/api/hooks/use-progress';
import { useSessionSocket } from '@/lib/ws/useSessionSocket';
import { useAuthStore } from '@/lib/store/auth-store';
import type { Block } from '@/lib/api/types';
import { isInputBlock } from '@/lib/blocks';
import { progressPercent } from '@/lib/progress';
import { WorkbookBlock } from '@/components/live/WorkbookBlock';
import { RightPanel } from '@/components/live/RightPanel';
import { Brand } from '@/components/brand';
import { ConnectionBadge } from '@/components/live/ConnectionBadge';
import { SessionStateBanner } from '@/components/live/SessionStateBanner';
import { Spinner } from '@/components/ui/spinner';
import { Button } from '@/components/ui/button';
import { ArrowDown, ArrowUp } from 'lucide-react';

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

  const sessionQuery = useSession(sessionId, { participant: true });
  const myResponsesQuery = useMyResponses(sessionId);

  const { status, focusedBlockId, saveResponse, ended } = useSessionSocket(
    sessionId,
    { token: participantToken, debounceMs: 300 },
  );

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

  const handleAnswer = React.useCallback(
    (blockId: string, answerText: string) => {
      setAnswers((prev) => ({ ...prev, [blockId]: answerText }));
      setActiveBlockId(blockId);
      saveResponse(blockId, answerText);
    },
    [saveResponse],
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

  // Watch whether the focused block is in view (no auto-scroll). If it leaves
  // the viewport, show a jump button pointing up or down toward it.
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
  if (sessionQuery.isLoading) {
    return (
      <main className="container flex min-h-screen items-center justify-center">
        <Spinner className="h-6 w-6" label={tc('loading')} />
      </main>
    );
  }

  const isEndedSession = ended || sessionQuery.data?.status === 'ended';

  // Any load failure (404 unknown session, expired participant token, etc.)
  // is shown as "not found" to the guest.
  if (sessionQuery.error) {
    return <SessionStateBanner kind="notFound" />;
  }
  if (isEndedSession) {
    return <SessionStateBanner kind="ended" />;
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
        <ConnectionBadge status={status} />
      </header>

      <div className="grid flex-1 gap-6 lg:grid-cols-[1fr_360px]">
        {/* Workbook — single centered reading column */}
        <section className="mx-auto w-full max-w-2xl space-y-4">
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
            />
          ))}
        </section>

        {/* Right panel — Navigation · Materials · Notes · AI */}
        <aside className="lg:sticky lg:top-6 lg:h-[calc(100vh-3rem)]">
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
            className="h-full"
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
    </main>
  );
}
