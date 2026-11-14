'use client';

import * as React from 'react';

/**
 * Makes a sticky, independently scrollable side column move together with the
 * page: scrolling the main feed down scrolls the column down by the same
 * amount, scrolling back up brings its top back. The column can still be
 * scrolled on its own with the wheel or a finger.
 *
 * Skipped while the column shows the lesson navigation list, which keeps the
 * current block in view by itself.
 */
export function useScrollAlong(ref: React.RefObject<HTMLElement | null>): void {
  React.useEffect(() => {
    let last = window.scrollY;
    let frame = 0;
    const onScroll = () => {
      if (frame) return;
      frame = window.requestAnimationFrame(() => {
        frame = 0;
        const el = ref.current;
        const y = window.scrollY;
        const delta = y - last;
        last = y;
        if (!el || el.scrollHeight <= el.clientHeight + 1) return;
        // Only when the column is a pinned, scrollable panel (desktop layout).
        if (getComputedStyle(el).overflowY === 'visible') return;
        if (el.querySelector('[data-nav]')) return;
        if (y <= 0) {
          el.scrollTop = 0;
          return;
        }
        el.scrollTop += delta;
      });
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      window.removeEventListener('scroll', onScroll);
      if (frame) window.cancelAnimationFrame(frame);
    };
  }, [ref]);
}
