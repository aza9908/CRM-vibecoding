/**
 * Lesson sections («блоки тетради»).
 *
 * A lesson can be divided into sections that the class goes through one at
 * a time: a section starts at a text block whose `blockRole` is `section`
 * (its `content` is the section title) and runs until the next such block.
 * Blocks before the first header form an untitled opening section. A lesson
 * without section headers is one single section — the old behaviour.
 *
 * During a live session the teacher opens sections in order
 * (`live_sessions.unlocked_sections`); students get the content of opened
 * sections only, and just the title of the locked ones.
 */

export const SECTION_BLOCK_ROLE = 'section';

export interface SectionBlockLike {
  blockRole?: string | null;
  content?: string | null;
}

export interface LessonSection<T> {
  /** 0-based position. */
  index: number;
  /** The header block, or null for blocks that precede the first header. */
  header: T | null;
  /** Content blocks (the header itself is not included). */
  blocks: T[];
}

export function isSectionHeader(block: SectionBlockLike): boolean {
  return block.blockRole === SECTION_BLOCK_ROLE;
}

/** Split an ordered block list into sections. Always returns ≥ 1 section. */
export function splitSections<T extends SectionBlockLike>(blocks: readonly T[]): LessonSection<T>[] {
  const sections: LessonSection<T>[] = [];
  let current: LessonSection<T> | null = null;
  for (const block of blocks) {
    if (isSectionHeader(block)) {
      current = { index: sections.length, header: block, blocks: [] };
      sections.push(current);
      continue;
    }
    if (!current) {
      current = { index: 0, header: null, blocks: [] };
      sections.push(current);
    }
    current.blocks.push(block);
  }
  if (sections.length === 0) sections.push({ index: 0, header: null, blocks: [] });
  return sections;
}

/** Title of a section header: first line of its content, markdown marks stripped. */
export function sectionTitle(header: SectionBlockLike | null): string {
  const first = (header?.content ?? '').split('\n').find((l) => l.trim().length > 0) ?? '';
  return first.replace(/^[#>\s*_]+/, '').replace(/[*_]+$/g, '').trim();
}

/**
 * What a student may receive: every block of the first `unlocked` sections,
 * and only the header (title) of the rest.
 */
export function visibleBlocksForStudent<T extends SectionBlockLike>(
  blocks: readonly T[],
  unlocked: number,
): T[] {
  const out: T[] = [];
  for (const s of splitSections(blocks)) {
    if (s.header) out.push(s.header);
    if (s.index < Math.max(1, unlocked)) out.push(...s.blocks);
  }
  return out;
}
