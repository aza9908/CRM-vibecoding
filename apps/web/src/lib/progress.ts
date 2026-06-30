import type { BlockType } from '@lms/shared';
import type { Block } from '@/lib/api/types';

/**
 * Per-block progress state shown in the "Navigation" tab (docs/08 §4).
 *
 * Priority order (highest first):
 *   1. `focused`   — the teacher is currently focusing this block;
 *   2. `active`    — the block the student is currently working on;
 *   3. `completed` — the student has answered it, OR it is a passive block
 *                    (text/image) that sits before the last answered block
 *                    ("smart progression");
 *   4. `pending`   — not started.
 */
export type BlockState = 'completed' | 'active' | 'focused' | 'pending';

/**
 * Block types that require an explicit student answer to count as completed.
 * Passive blocks (text/image) are completed via smart progression instead.
 */
const INTERACTIVE_BLOCK_TYPES: readonly BlockType[] = [
  'input_text',
  'input_select',
  'input_rating',
  'input_file',
  'action_button',
  'test',
];

/** Whether a block requires an explicit answer/interaction. */
export function isInteractiveBlock(type: BlockType): boolean {
  return INTERACTIVE_BLOCK_TYPES.includes(type);
}

/** Whether a block is purely presentational (no answer expected). */
export function isPassiveBlock(type: BlockType): boolean {
  return !isInteractiveBlock(type);
}

/** Index of the last block that satisfies `pred`, or -1 if none do. */
function lastIndexWith<T>(items: T[], pred: (item: T) => boolean): number {
  for (let i = items.length - 1; i >= 0; i -= 1) {
    const item = items[i];
    if (item !== undefined && pred(item)) return i;
  }
  return -1;
}

/**
 * Compute the navigation status of every block (docs/08 §4).
 *
 * @param blocks         lesson blocks in display order
 * @param answered       ids of blocks the student has answered (from
 *                       `responses` + the student's own local answers)
 * @param activeBlockId  the block the student is currently working on (null = none)
 * @param focusedBlockId the teacher's currently focused block (null = none)
 */
export function computeBlockStates(
  blocks: Block[],
  answered: Set<string>,
  activeBlockId: string | null,
  focusedBlockId: string | null,
): Map<string, BlockState> {
  const states = new Map<string, BlockState>();
  const lastAnsweredIdx = lastIndexWith(blocks, (b) => answered.has(b.id));

  blocks.forEach((b, i) => {
    if (b.id === focusedBlockId) {
      states.set(b.id, 'focused'); // teacher focus wins
    } else if (b.id === activeBlockId) {
      states.set(b.id, 'active');
    } else if (answered.has(b.id)) {
      states.set(b.id, 'completed');
    } else if (isPassiveBlock(b.type) && i < lastAnsweredIdx) {
      states.set(b.id, 'completed'); // smart progression for passive blocks
    } else {
      states.set(b.id, 'pending');
    }
  });

  return states;
}

/**
 * Lesson completion percent over **interactive** blocks only (docs/08 §4):
 * answered interactive blocks / total interactive blocks, rounded. A lesson
 * with no interactive blocks reports 0 (there is nothing to complete).
 *
 * This is the value persisted to `lesson_progress.progressPercent`.
 */
export function progressPercent(
  blocks: Block[],
  answered: Set<string>,
): number {
  const interactive = blocks.filter((b) => isInteractiveBlock(b.type));
  if (interactive.length === 0) return 0;
  const done = interactive.filter((b) => answered.has(b.id)).length;
  return Math.round((done / interactive.length) * 100);
}
