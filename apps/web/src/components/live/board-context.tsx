'use client';

import * as React from 'react';

/**
 * Status boards on the lesson page. Everyone sees the ticks; only the
 * teacher's page passes `onSet`, which makes the cells clickable.
 */
export interface BoardContextValue {
  /** block id → (row index → ticked column index). */
  boards: Record<string, Record<string, number>>;
  onSet?: (blockId: string, row: number, col: number | null) => void;
  /**
   * Teacher page only, for self-reported status boards (`options.self`):
   * everyone in the session and their current answer to a block.
   */
  people?: { participantId: string; name: string }[];
  answerOf?: (participantId: string, blockId: string) => string | undefined;
}

export const BoardContext = React.createContext<BoardContextValue>({ boards: {} });
