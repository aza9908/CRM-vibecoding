/** Centralized TanStack Query keys so invalidation stays consistent. */
export const queryKeys = {
  me: ['me'] as const,
  lessons: ['lessons'] as const,
  lesson: (id: string) => ['lessons', id] as const,
  curriculum: ['curriculum'] as const,
  session: (id: string) => ['sessions', id] as const,
  sessionParticipants: (id: string) =>
    ['sessions', id, 'participants'] as const,
  sessionResponses: (id: string) => ['sessions', id, 'responses'] as const,
  myResponses: (sessionId: string) =>
    ['sessions', sessionId, 'my-responses'] as const,
  liveSessions: ['sessions', 'live'] as const,
  materials: ['materials'] as const,
  lessonMaterials: (lessonId: string) =>
    ['lessons', lessonId, 'materials'] as const,
  lessonNotes: (lessonId: string) => ['lessons', lessonId, 'notes'] as const,
  lessonProgress: (lessonId: string) =>
    ['lessons', lessonId, 'progress'] as const,
  // Reports & analytics (docs/09). Read-only aggregates rendered as-is.
  lessonSessions: (lessonId: string) =>
    ['lessons', lessonId, 'sessions'] as const,
  sessionReport: (sessionId: string) =>
    ['sessions', sessionId, 'report'] as const,
  companyStats: ['analytics', 'company'] as const,
  companyUser: (userId: string) =>
    ['analytics', 'company', 'users', userId] as const,
  adminUsers: ['admin', 'users'] as const,
  tasks: ['tasks'] as const,
};
