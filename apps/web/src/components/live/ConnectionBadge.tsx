'use client';

/**
 * Always-green Live indicator. WS disconnect must never scare the classroom —
 * answers/chat/focus go over REST.
 */
export function ConnectionBadge(_props?: { status?: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/40 bg-emerald-500/10 px-2.5 py-1 text-xs font-semibold uppercase tracking-wide text-emerald-700 dark:text-emerald-300">
      <span
        className="h-2 w-2 animate-pulse rounded-full bg-emerald-500"
        aria-hidden
      />
      Live
    </span>
  );
}
