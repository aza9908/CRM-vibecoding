'use client';

import { useCallback } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api/client';
import type { ChatMessagePayload } from '@lms/shared';

export type LiveChatMessage = ChatMessagePayload;

/** Poll group chat every 1.5s — REST is the source of truth. */
export function useSessionChat(
  sessionId: string | undefined,
  opts?: { participant?: boolean },
) {
  return useQuery({
    queryKey: ['session-chat', sessionId, opts?.participant ? 'p' : 'u'],
    queryFn: () =>
      api.get<LiveChatMessage[]>(`/sessions/${sessionId}/chat`, {
        participant: opts?.participant,
      }),
    enabled: !!sessionId,
    refetchInterval: 2_000,
    refetchIntervalInBackground: true,
    staleTime: 1_000,
    placeholderData: (prev) => prev,
    retry: 4,
  });
}

export function useSendSessionChat(
  sessionId: string | undefined,
  opts?: { participant?: boolean },
) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (text: string) =>
      api.post<LiveChatMessage>(
        `/sessions/${sessionId}/chat`,
        { text },
        { participant: opts?.participant },
      ),
    onSuccess: (msg) => {
      if (!sessionId) return;
      const key = ['session-chat', sessionId, opts?.participant ? 'p' : 'u'];
      qc.setQueryData<LiveChatMessage[]>(key, (prev) => {
        const list = prev ?? [];
        if (list.some((m) => m.id === msg.id)) return list;
        return [...list, msg];
      });
      void qc.invalidateQueries({ queryKey: ['session-chat', sessionId] });
    },
  });
}

/** Persist a student answer over REST (reliable on App Hosting). `completed`
 * is an explicit override for the fullscreen slide view's mark-complete
 * checkmark — omit it to keep today's auto-derived behavior. */
export function useSaveSessionResponse(sessionId: string | undefined) {
  return useMutation({
    mutationFn: (input: {
      blockId: string;
      answerText: string;
      completed?: boolean;
    }) =>
      api.post<{ ok: boolean }>(
        `/sessions/${sessionId}/responses`,
        input,
        { participant: true },
      ),
  });
}

/**
 * Upload a file/screenshot as the answer to an `input_file` block
 * (`POST /sessions/:id/responses/upload`). Returns once the file is stored
 * and the response is saved server-side with `completed: true`.
 */
export function useUploadResponseFile(sessionId: string | undefined) {
  return useMutation({
    mutationFn: async (input: { blockId: string; file: File }) => {
      const form = new FormData();
      form.append('file', input.file);
      form.append('blockId', input.blockId);
      return api.post<{ ok: boolean; blockId: string; fileName: string }>(
        `/sessions/${sessionId}/responses/upload`,
        form,
        { participant: true },
      );
    },
  });
}

/** Resolve a presigned download URL for a `file:` answer on an `input_file`
 * block. Reachable by the answering participant (self) or a teacher/admin
 * viewing the session — `asParticipant` selects which token the request
 * authenticates with. */
export function useResponseFileUrl(
  sessionId: string | undefined,
  opts?: { asParticipant?: boolean },
) {
  return useMutation({
    mutationFn: (input: { participantId: string; blockId: string }) =>
      api.get<{ url: string }>(
        `/sessions/${sessionId}/responses/${input.participantId}/${input.blockId}/download`,
        { participant: opts?.asParticipant },
      ),
  });
}

/** Combined helper for pages that need REST chat send. */
export function useLiveChatActions(
  sessionId: string | undefined,
  opts?: { participant?: boolean },
) {
  const chatQuery = useSessionChat(sessionId, opts);
  const sendMut = useSendSessionChat(sessionId, opts);

  const sendChat = useCallback(
    (text: string) => {
      const trimmed = text.trim();
      if (!trimmed || !sessionId) return;
      sendMut.mutate(trimmed);
    },
    [sendMut, sessionId],
  );

  return {
    messages: chatQuery.data ?? [],
    sendChat,
    isSending: sendMut.isPending,
    chatError: sendMut.error,
  };
}
