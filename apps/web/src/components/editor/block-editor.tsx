'use client';

import { useTranslations } from 'next-intl';
import { Plus, X } from 'lucide-react';
import type { EditorBlock } from './editor-block';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { ImageUpload } from './image-upload';
import {
  readActionButtonOptions,
  readRatingOptions,
  readSelectOptions,
  readTestOptions,
} from './block-options';

type Patch = Partial<Omit<EditorBlock, 'localId' | 'type'>>;

interface Props {
  block: EditorBlock;
  onChange: (patch: Patch) => void;
}

/** A reusable editor for a list of string choices (select / test). */
function ChoiceList({
  groupId,
  choices,
  onChange,
  selectedIndex,
  onSelect,
}: {
  groupId: string;
  choices: string[];
  onChange: (next: string[]) => void;
  selectedIndex?: number;
  onSelect?: (index: number) => void;
}) {
  const t = useTranslations('editor');
  return (
    <div className="flex flex-col gap-2">
      <Label className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {t('options')}
      </Label>
      {choices.map((choice, i) => (
        <div key={i} className="flex items-center gap-2">
          {onSelect ? (
            <input
              type="radio"
              name={`correct-${groupId}`}
              checked={selectedIndex === i}
              onChange={() => onSelect(i)}
              aria-label={`correct-${i}`}
              className="h-4 w-4 shrink-0 accent-primary"
            />
          ) : null}
          <Input
            value={choice}
            onChange={(e) => {
              const next = [...choices];
              next[i] = e.target.value;
              onChange(next);
            }}
          />
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="shrink-0 text-muted-foreground hover:text-destructive"
            onClick={() => onChange(choices.filter((_, idx) => idx !== i))}
            disabled={choices.length <= 1}
            aria-label="Remove option"
          >
            <X />
          </Button>
        </div>
      ))}
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="w-fit"
        onClick={() => onChange([...choices, ''])}
      >
        <Plus />
        {t('options')}
      </Button>
    </div>
  );
}

/** Renders the right editing UI for a block based on its type. */
export function BlockEditor({ block, onChange }: Props) {
  const t = useTranslations('editor');

  switch (block.type) {
    case 'text':
      return (
        <div className="flex flex-col gap-1.5">
          <Label className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            {t('blockContent')}
          </Label>
          <Textarea
            value={block.content ?? ''}
            onChange={(e) => onChange({ content: e.target.value })}
            rows={4}
          />
        </div>
      );

    case 'image':
      return (
        <ImageUpload
          value={block.imageUrl}
          onChange={(url) => onChange({ imageUrl: url })}
        />
      );

    case 'input_text':
      return (
        <div className="flex flex-col gap-1.5">
          <Label className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            {t('blockContent')}
          </Label>
          <Input
            value={block.content ?? ''}
            onChange={(e) => onChange({ content: e.target.value })}
            placeholder={t('topicPlaceholder')}
          />
        </div>
      );

    case 'input_select': {
      const opts = readSelectOptions(block.options);
      return (
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <Label className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            {t('blockContent')}
          </Label>
            <Input
              value={block.content ?? ''}
              onChange={(e) => onChange({ content: e.target.value })}
            />
          </div>
          <ChoiceList
            groupId={block.localId}
            choices={opts.choices}
            onChange={(choices) => onChange({ options: { ...opts, choices } })}
          />
        </div>
      );
    }

    case 'input_rating': {
      const opts = readRatingOptions(block.options);
      return (
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <Label className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            {t('blockContent')}
          </Label>
            <Input
              value={block.content ?? ''}
              onChange={(e) => onChange({ content: e.target.value })}
            />
          </div>
          <div className="flex gap-3">
            <div className="flex flex-col gap-1.5">
              <Label className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                min
              </Label>
              <Input
                type="number"
                value={opts.min}
                onChange={(e) =>
                  onChange({
                    options: { ...opts, min: Number(e.target.value) },
                  })
                }
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                max
              </Label>
              <Input
                type="number"
                value={opts.max}
                onChange={(e) =>
                  onChange({
                    options: { ...opts, max: Number(e.target.value) },
                  })
                }
              />
            </div>
          </div>
        </div>
      );
    }

    case 'action_button': {
      const opts = readActionButtonOptions(block.options);
      return (
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <Label className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              label
            </Label>
            <Input
              value={opts.label}
              onChange={(e) =>
                onChange({ options: { ...opts, label: e.target.value } })
              }
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              href
            </Label>
            <Input
              value={opts.href}
              onChange={(e) =>
                onChange({ options: { ...opts, href: e.target.value } })
              }
              placeholder="https://…"
            />
          </div>
        </div>
      );
    }

    case 'input_file':
      return (
        <div className="flex flex-col gap-1.5">
          <Label className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            {t('blockContent')}
          </Label>
          <Input
            value={block.content ?? ''}
            onChange={(e) => onChange({ content: e.target.value })}
            placeholder={t('blockInputFile')}
          />
        </div>
      );

    case 'test': {
      const opts = readTestOptions(block.options);
      return (
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <Label className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            {t('blockContent')}
          </Label>
            <Input
              value={opts.question}
              onChange={(e) =>
                onChange({ options: { ...opts, question: e.target.value } })
              }
            />
          </div>
          <ChoiceList
            groupId={block.localId}
            choices={opts.choices}
            selectedIndex={opts.correctIndex}
            onSelect={(correctIndex) =>
              onChange({ options: { ...opts, correctIndex } })
            }
            onChange={(choices) =>
              onChange({
                options: {
                  ...opts,
                  choices,
                  correctIndex: Math.min(opts.correctIndex, choices.length - 1),
                },
              })
            }
          />
        </div>
      );
    }

    default:
      return null;
  }
}
