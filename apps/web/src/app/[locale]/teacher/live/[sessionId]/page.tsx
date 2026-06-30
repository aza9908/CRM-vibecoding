'use client';

import * as React from 'react';
import { useParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import {
  useSession,
  useSessionParticipants,
  useSessionResponses,
  useEndSession,
} from '@/lib/api/hooks/use-sessions';
import {
  useSessionSocket,
  type LiveParticipant,
  type LiveResponses,
} from '@/lib/ws/useSessionSocket';
import { useAuthStore } from '@/lib/store/auth-store';
import type { Block } from '@/lib/api/types';
import { isInputBlock } from '@/lib/blocks';
import { SessionCode } from '@/components/live/SessionCode';
import { ParticipantsList } from '@/components/live/ParticipantsList';
import { ResponsesSummary } from '@/components/live/ResponsesSummary';
import { ConnectionBadge } from '@/components/live/ConnectionBadge';
import { SessionStateBanner } from '@/components/live/SessionStateBanner';
import { WorkbookBlock } from '@/components/live/WorkbookBlock';
import { Brand } from '@/components/brand';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { Card } from '@/components/ui/card';
import { Users } from 'lucide-react';

function responseKey(participantId: string, blockId: string): string {
  return `${participantId}:${blockId}`;
}

/**
 * /teacher/live/[sessionId] — the teacher's live control panel.
 *
 * - Connects to /live with the user access token; emits session:join.
 * - Shows a copyable session code, the live participant roster
 *   (participant:joined merged with the REST baseline), and the answer board
 *   (response:updated merged with the REST baseline).
 * - Clicking a block emits focus:set (broadcast to students as focus:changed).
 * - "End" calls POST /sessions/:id/end; the server emits session:ended and we
 *   show the ended banner.
 */
export default function TeacherLivePage() {
  const params = useParams<{ sessionId: string }>();
  const sessionId = params?.sessionId;
  const t = useTranslations('live');
  const tc = useTranslations('common');

  const accessToken = useAuthStore((s) => s.accessToken);

  const sessionQuery = useSession(sessionId);
  const participantsQuery = useSessionParticipants(sessionId);
  const responsesQuery = useSessionResponses(sessionId);
  const endSession = useEndSession();

  const {
    status,
    focusedBlockId,
    sendFocus,
    participants: liveParticipants,
    responses: liveResponses,
    ended,
  } = useSessionSocket(sessionId, { token: accessToken });

  // Merge REST baseline + live deltas so a late-connecting teacher still sees
  // everyone who joined / answered before the socket was up.
  const participants = React.useMemo<LiveParticipant[]>(() => {
    const map = new Map<string, LiveParticipant>();
    for (const p of participantsQuery.data ?? []) {
      map.set(p.id, { participantId: p.id, name: p.name });
    }
    for (const p of liveParticipants) {
      map.set(p.participantId, p);
    }
    return [...map.values()];
  }, [participantsQuery.data, liveParticipants]);

  const responses = React.useMemo<LiveResponses>(() => {
    const merged: LiveResponses = {};
    for (const r of responsesQuery.data ?? []) {
      merged[responseKey(r.participantId, r.blockId)] = {
        participantId: r.participantId,
        blockId: r.blockId,
        answerText: r.answerText,
        at: r.updatedAt,
      };
    }
    // Live updates win over the REST snapshot.
    for (const [key, value] of Object.entries(liveResponses)) {
      merged[key] = value;
    }
    return merged;
  }, [responsesQuery.data, liveResponses]);

  const blocks: Block[] = sessionQuery.data?.blocks ?? [];
  const inputBlocks = React.useMemo(
    () => blocks.filter((b) => isInputBlock(b.type)),
    [blocks],
  );

  const effectiveFocus = focusedBlockId ?? sessionQuery.data?.focusedBlockId ?? null;

  const handleEnd = React.useCallback(() => {
    if (!sessionId) return;
    if (!window.confirm(t('endConfirm'))) return;
    endSession.mutate(sessionId);
  }, [sessionId, endSession, t]);

  if (sessionQuery.isLoading) {
    return (
      <main className="container flex min-h-screen items-center justify-center">
        <Spinner className="h-6 w-6" label={tc('loading')} />
      </main>
    );
  }

  // 404 (unknown session) or 403 (another org's session) — both surface as
  // "not found" so we never leak cross-tenant existence.
  if (sessionQuery.error) {
    return <SessionStateBanner kind="notFound" homeHref="/lessons" />;
  }

  const isEnded =
    ended ||
    endSession.isSuccess ||
    sessionQuery.data?.status === 'ended';
  if (isEnded) {
    return <SessionStateBanner kind="ended" homeHref="/lessons" />;
  }

  return (
    <main className="flex min-h-screen flex-col bg-background">
      {/* Top control bar */}
      <header className="sticky top-0 z-10 border-b bg-card/80 backdrop-blur">
        <div className="container flex flex-wrap items-center gap-x-6 gap-y-3 py-3">
          <div className="flex items-center gap-3">
            <Brand />
            <span className="hidden text-sm text-muted-foreground sm:inline">
              {t('teacherTitle')}
            </span>
          </div>

          {sessionQuery.data?.code && (
            <div className="order-last w-full sm:order-none sm:w-auto">
              <SessionCode code={sessionQuery.data.code} />
            </div>
          )}

          <div className="ml-auto flex items-center gap-4">
            <ConnectionBadge status={status} />
            <span className="inline-flex items-center gap-1.5 text-sm text-muted-foreground">
              <Users className="h-4 w-4" />
              {participants.length}
            </span>
            <Button
              type="button"
              variant="destructive"
              onClick={handleEnd}
              disabled={endSession.isPending}
            >
              {endSession.isPending ? (
                <Spinner className="h-4 w-4" />
              ) : (
                t('endSession')
              )}
            </Button>
          </div>
        </div>
      </header>

      <div className="container flex flex-1 flex-col gap-6 py-6">
        <div className="grid gap-6 lg:grid-cols-[1fr_1fr]">
          {/* Workbook preview — click a block to focus it for students. */}
          <section className="space-y-3">
            <h2 className="text-sm font-semibold">{t('focusBlock')}</h2>
            {blocks.length === 0 && (
              <p className="text-sm text-muted-foreground">{tc('empty')}</p>
            )}
            {blocks.map((block) => (
              <WorkbookBlock
                key={block.id}
                block={block}
                focused={block.id === effectiveFocus}
                readOnly
                onFocusClick={sendFocus}
              />
            ))}
          </section>

          {/* Right column: live roster + answer board. */}
          <section className="space-y-6">
            <Card className="p-4">
              <ParticipantsList participants={participants} />
            </Card>
            <Card className="p-4">
              <ResponsesSummary
                responses={responses}
                participants={participants}
                blocks={inputBlocks}
                focusedBlockId={effectiveFocus}
                onFocusBlock={sendFocus}
              />
            </Card>
          </section>
        </div>
      </div>
    </main>
  );
}
