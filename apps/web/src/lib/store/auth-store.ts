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
 * The API also sets the refresh token as an httpOnly cookie on its own domain.
 * When the app is served from another site (https://airl.kz/lms while the API
 * is on lms-api.magauin.kz) browsers treat that cookie as third-party and do
 * not send it, so the refresh token from the auth response is kept here too
 * and sent in the body of POST /auth/refresh (which the API accepts).
 */
export interface AuthState {
  accessToken: string | null;
  refreshToken: string | null;
  user: PublicUser | null;
  participantToken: string | null;
  sessionId: string | null;

  setAuth: (accessToken: string, user: PublicUser, refreshToken?: string | null) => void;
  setRefreshToken: (refreshToken: string | null) => void;
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
      refreshToken: null,
      user: null,
      participantToken: null,
      sessionId: null,

      setAuth: (accessToken, user, refreshToken) =>
        set((s) => ({
          accessToken,
          user,
          refreshToken: refreshToken === undefined ? s.refreshToken : refreshToken,
        })),
      setRefreshToken: (refreshToken) => set({ refreshToken }),
      setAccessToken: (accessToken) => set({ accessToken }),
      setUser: (user) => set({ user }),
      setParticipant: (participantToken, sessionId) =>
        set({ participantToken, sessionId }),
      clearParticipant: () => set({ participantToken: null, sessionId: null }),
      clear: () =>
        set({
          accessToken: null,
          refreshToken: null,
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
        refreshToken: state.refreshToken,
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
