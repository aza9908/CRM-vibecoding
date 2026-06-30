'use client';

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import type { PublicUser } from '@lms/shared';

/**
 * Client-side auth/session state.
 *
 * - `accessToken` + `user`: full User session (teacher/student/admin), aud=user.
 * - `participantToken` + `sessionId`: lightweight participant session (join by code),
 *   aud=participant. A guest who joined by code only has these.
 *
 * The refresh token lives in an httpOnly cookie set by the API and is never
 * exposed to JS. Only the short-lived access token is held in memory/storage.
 */
export interface AuthState {
  accessToken: string | null;
  user: PublicUser | null;
  participantToken: string | null;
  sessionId: string | null;

  setAuth: (accessToken: string, user: PublicUser) => void;
  setAccessToken: (accessToken: string | null) => void;
  setUser: (user: PublicUser | null) => void;
  setParticipant: (participantToken: string, sessionId: string) => void;
  clearParticipant: () => void;
  clear: () => void;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      accessToken: null,
      user: null,
      participantToken: null,
      sessionId: null,

      setAuth: (accessToken, user) => set({ accessToken, user }),
      setAccessToken: (accessToken) => set({ accessToken }),
      setUser: (user) => set({ user }),
      setParticipant: (participantToken, sessionId) =>
        set({ participantToken, sessionId }),
      clearParticipant: () => set({ participantToken: null, sessionId: null }),
      clear: () =>
        set({
          accessToken: null,
          user: null,
          participantToken: null,
          sessionId: null,
        }),
    }),
    {
      name: 'lms-auth',
      storage: createJSONStorage(() => localStorage),
      // Persist tokens + identity so a refresh keeps the session.
      partialize: (state) => ({
        accessToken: state.accessToken,
        user: state.user,
        participantToken: state.participantToken,
        sessionId: state.sessionId,
      }),
    },
  ),
);

/** Read the current access token outside of React (e.g. in the fetch client). */
export function getAccessToken(): string | null {
  return useAuthStore.getState().accessToken;
}

/** Read the current participant token outside of React (e.g. WS handshake). */
export function getParticipantToken(): string | null {
  return useAuthStore.getState().participantToken;
}
