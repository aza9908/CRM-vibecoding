import type { BlockType } from '@lms/shared';

/** Block types that accept a student answer (vs. presentational blocks). */
export const INPUT_BLOCK_TYPES: readonly BlockType[] = [
  'input_text',
  'input_select',
  'input_rating',
  'input_file',
  'test',
];

/** Whether a block type collects an answer from the student. */
export function isInputBlock(type: BlockType): boolean {
  return INPUT_BLOCK_TYPES.includes(type);
}

/** i18n key (under the "editor" namespace) for a block type's display label. */
export function blockLabelKey(type: BlockType): string {
  switch (type) {
    case 'text':
      return 'blockText';
    case 'image':
      return 'blockImage';
    case 'input_text':
      return 'blockInputText';
    case 'input_select':
      return 'blockInputSelect';
    case 'input_rating':
      return 'blockInputRating';
    case 'action_button':
      return 'blockActionButton';
    case 'input_file':
      return 'blockInputFile';
    case 'test':
      return 'blockTest';
    default:
      return 'blockText';
  }
}

/** All block types in editor palette order. */
export const ALL_BLOCK_TYPES: readonly BlockType[] = [
  'text',
  'image',
  'input_text',
  'input_select',
  'input_rating',
  'action_button',
  'input_file',
  'test',
];
