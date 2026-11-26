'use client';

import * as React from 'react';

/**
 * What the fullscreen slide viewer needs from the lesson page around it.
 *
 * - `onSlide`: the teacher pages through slides in fullscreen → the page moves
 *   the class focus to that slide, so students follow without extra clicks.
 * - `overlay`: layers shown on top of the fullscreen viewer. A fullscreen
 *   element hides everything outside it, so the class pulse (reactions,
 *   «всё понятно?») has to be rendered inside the viewer to stay visible.
 */
export interface SlideshowContextValue {
  onSlide?: (blockId: string) => void;
  overlay?: React.ReactNode;
  /**
   * Student page: the block the teacher has in focus. A student watching in
   * fullscreen follows it — the viewer pages to that slide, or closes when
   * the teacher moves to something that is not a slide (a task, a question).
   */
  followId?: string | null;
}

export const SlideshowContext = React.createContext<SlideshowContextValue>({});
