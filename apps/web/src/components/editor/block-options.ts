/**
 * Narrowing helpers for the free-form `options` payload of input blocks.
 * `options` is typed `unknown` in the shared DTO; these readers/normalizers
 * keep the per-type editors type-safe without inventing new shared types.
 */

export interface SelectOptions {
  choices: string[];
}

export interface RatingOptions {
  min: number;
  max: number;
}

export interface ActionButtonOptions {
  label: string;
  href: string;
}

export interface TestOptions {
  question: string;
  choices: string[];
  correctIndex: number;
}

/** One line of a `checklist` block — a label with an optional instruction link. */
export interface ChecklistItem {
  text: string;
  url?: string;
}

export interface ChecklistOptions {
  items: ChecklistItem[];
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.map((v) => (typeof v === 'string' ? v : String(v ?? ''))) : [];
}

export function readSelectOptions(value: unknown): SelectOptions {
  const rec = asRecord(value);
  const choices = asStringArray(rec.choices);
  return { choices: choices.length ? choices : ['', ''] };
}

export function readRatingOptions(value: unknown): RatingOptions {
  const rec = asRecord(value);
  const min = typeof rec.min === 'number' ? rec.min : 1;
  const max = typeof rec.max === 'number' ? rec.max : 5;
  return { min, max };
}

export function readActionButtonOptions(value: unknown): ActionButtonOptions {
  const rec = asRecord(value);
  return {
    label: typeof rec.label === 'string' ? rec.label : '',
    href: typeof rec.href === 'string' ? rec.href : '',
  };
}

export function readTestOptions(value: unknown): TestOptions {
  const rec = asRecord(value);
  const choices = asStringArray(rec.choices);
  const correctIndex = typeof rec.correctIndex === 'number' ? rec.correctIndex : 0;
  return {
    question: typeof rec.question === 'string' ? rec.question : '',
    choices: choices.length ? choices : ['', ''],
    correctIndex,
  };
}

export function readChecklistOptions(value: unknown): ChecklistOptions {
  const rec = asRecord(value);
  const raw = Array.isArray(rec.items) ? rec.items : [];
  const items: ChecklistItem[] = raw.map((v) => {
    if (v && typeof v === 'object') {
      const o = v as Record<string, unknown>;
      return {
        text: typeof o.text === 'string' ? o.text : '',
        url: typeof o.url === 'string' && o.url ? o.url : undefined,
      };
    }
    return { text: typeof v === 'string' ? v : '' };
  });
  return { items: items.length ? items : [{ text: '' }] };
}
