import type { BlockDto, BlockType } from '@lms/shared';
import type { Block } from '@/lib/api/types';

/**
 * An editor block carries a stable client-side key (`localId`) so @dnd-kit and
 * React can track rows even before they have a server `id`. The server `id`
 * (if present) is preserved and sent back on publish so the bulk-save endpoint
 * upserts instead of recreating.
 */
export interface EditorBlock {
  /** Stable key for React / dnd-kit. Not sent to the server. */
  localId: string;
  /** Server id (uuid) — present only for already-persisted blocks. */
  id?: string;
  type: BlockType;
  content?: string | null;
  imageUrl?: string | null;
  /** Free-form per-type options (e.g. select choices, rating scale). */
  options?: unknown;
  outcomeId?: string | null;
  blockRole?: string | null;
  generatedBy?: 'manual' | 'ai';
}

let counter = 0;

/** Generate a stable local key for a new editor block. */
export function newLocalId(): string {
  counter += 1;
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  return `b_${Date.now()}_${counter}`;
}

/** Default empty options for a freshly-added block, by type. */
function defaultOptions(type: BlockType): unknown {
  switch (type) {
    case 'input_select':
      return { choices: ['', ''] };
    case 'input_rating':
      return { min: 1, max: 5 };
    case 'action_button':
      return { label: '', href: '' };
    case 'test':
      return { question: '', choices: ['', ''], correctIndex: 0 };
    default:
      return null;
  }
}

/** Create a new, empty editor block of the given type. */
export function createBlock(type: BlockType): EditorBlock {
  return {
    localId: newLocalId(),
    type,
    content: '',
    imageUrl: null,
    options: defaultOptions(type),
    outcomeId: null,
    blockRole: null,
    generatedBy: 'manual',
  };
}

/** Hydrate persisted/AI blocks (which carry a server id) into editor blocks. */
export function toEditorBlocks(blocks: (Block | BlockDto)[]): EditorBlock[] {
  return blocks.map((b) => ({
    localId: newLocalId(),
    id: b.id,
    type: b.type,
    content: b.content ?? '',
    imageUrl: b.imageUrl ?? null,
    options: b.options ?? null,
    outcomeId: b.outcomeId ?? null,
    blockRole: b.blockRole ?? null,
    generatedBy: b.generatedBy ?? 'manual',
  }));
}

/** Strip the editor-only `localId` and produce the wire DTO for publish. */
export function toBlockDtos(blocks: EditorBlock[]): BlockDto[] {
  return blocks.map((b) => ({
    ...(b.id ? { id: b.id } : {}),
    type: b.type,
    content: b.content ?? null,
    imageUrl: b.imageUrl ?? null,
    options: b.options ?? null,
    outcomeId: b.outcomeId ?? null,
    blockRole: b.blockRole ?? null,
    generatedBy: b.generatedBy ?? 'manual',
  }));
}

/** localStorage key for a lesson's autosaved draft. */
export function draftKey(lessonId: string): string {
  return `lms-editor-draft:${lessonId}`;
}
