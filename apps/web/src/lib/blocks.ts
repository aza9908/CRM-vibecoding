import type { BlockType } from '@lms/shared';
import type { Block } from '@/lib/api/types';
import type { ZoomableImageSibling } from '@/components/live/ZoomableImage';

/** Block types that accept a student answer (vs. presentational blocks). */
export const INPUT_BLOCK_TYPES: readonly BlockType[] = [
  'input_text',
  'input_select',
  'input_rating',
  'input_file',
  'test',
  'checklist',
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
    case 'checklist':
      return 'blockChecklist';
    default:
      return 'blockText';
  }
}

/**
 * Maps each `image` block's id to its position within the lesson's full
 * image sequence, plus that sequence's sibling list — so the whole deck
 * (e.g. a PDF added as slides) pages through as one gallery in the
 * fullscreen lightbox. Images are pooled across the *entire* lesson, not
 * just contiguous runs: real lessons interleave input/text blocks between
 * slides (e.g. an artifact-link field after a batch of slides), and
 * breaking the gallery at every such block turned one deck into several
 * disconnected mini-galleries that each wrapped around independently
 * instead of continuing into the next segment. Pass the result's lookup
 * for a given block as `WorkbookBlock`'s `imageNav` prop.
 */
export function buildImageNavMap(
  blocks: Block[],
): Map<string, { images: ZoomableImageSibling[]; index: number }> {
  const images: ZoomableImageSibling[] = [];
  const ids: string[] = [];

  for (const b of blocks) {
    if (b.type === 'image' && b.imageUrl) {
      images.push({ src: b.imageUrl, alt: b.content ?? '' });
      ids.push(b.id);
    }
  }

  const map = new Map<string, { images: ZoomableImageSibling[]; index: number }>();
  ids.forEach((id, i) => map.set(id, { images, index: i }));
  return map;
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
  'checklist',
];
