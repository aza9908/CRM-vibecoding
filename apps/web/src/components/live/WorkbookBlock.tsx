'use client';

import * as React from 'react';
import { useTranslations } from 'next-intl';
import { Eye, FileText, Link2, Paperclip, Upload } from 'lucide-react';
import type { Block } from '@/lib/api/types';
import { cn } from '@/lib/utils';
import { isInputBlock } from '@/lib/blocks';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { RichBlockText } from './RichBlockText';
import { ZoomableImage } from './ZoomableImage';

/** Convention for `input_file` answers stored as plain text in `answerText`. */
const FILE_ANSWER_PREFIX = 'file:';

/** Extract a YouTube video id from watch / embed / shorts / youtu.be URLs. */
function youtubeIdFromUrl(url: string): string | null {
  try {
    const u = new URL(url);
    if (u.hostname.includes('youtu.be')) {
      return u.pathname.replace(/^\//, '').split('/')[0] || null;
    }
    if (u.hostname.includes('youtube.com') || u.hostname.includes('youtube-nocookie.com')) {
      if (u.pathname.startsWith('/embed/')) {
        return u.pathname.split('/')[2] || null;
      }
      if (u.pathname.startsWith('/shorts/')) {
        return u.pathname.split('/')[2] || null;
      }
      return u.searchParams.get('v');
    }
  } catch {
    return null;
  }
  return null;
}

/** A single option for select-style blocks. */
interface SelectOption {
  id?: string;
  value?: string;
  label?: string;
}

/** Best-effort parse of a block's `options` JSON into a list of labels/values. */
function parseSelectOptions(options: unknown): SelectOption[] {
  if (!options) return [];
  if (Array.isArray(options)) {
    return options.map((o) => {
      if (typeof o === 'string') return { value: o, label: o };
      if (o && typeof o === 'object') {
        const obj = o as Record<string, unknown>;
        const label =
          (typeof obj.label === 'string' && obj.label) ||
          (typeof obj.text === 'string' && obj.text) ||
          (typeof obj.value === 'string' && obj.value) ||
          '';
        const value =
          (typeof obj.value === 'string' && obj.value) ||
          (typeof obj.id === 'string' && obj.id) ||
          label;
        return { id: typeof obj.id === 'string' ? obj.id : undefined, value, label };
      }
      return { value: String(o), label: String(o) };
    });
  }
  if (typeof options === 'object') {
    const obj = options as Record<string, unknown>;
    const choices = obj.options ?? obj.choices ?? obj.items;
    if (Array.isArray(choices)) return parseSelectOptions(choices);
  }
  return [];
}

export interface WorkbookBlockProps {
  block: Block;
  /** Whether this block is the one the teacher is currently focusing. */
  focused?: boolean;
  /** Read-only mode (teacher preview): inputs are disabled, no answers sent. */
  readOnly?: boolean;
  /** Current student answer for this block (controlled). */
  value?: string;
  /** Called whenever the student edits / submits an answer. */
  onAnswerChange?: (blockId: string, answerText: string) => void;
  /** Immediate flush (Submit) — same as onAnswerChange but parent should not debounce. */
  onAnswerSubmit?: (blockId: string, answerText: string) => void;
  /** Teacher mode: clicking the block focuses it for everyone. */
  onFocusClick?: (blockId: string) => void;
  /** `input_file` blocks only: upload a file/screenshot as the answer. */
  onFileUpload?: (blockId: string, file: File) => Promise<void>;
  /** `input_file` blocks only: resolve a download URL for a `file:` answer. */
  onResolveFileUrl?: (blockId: string) => Promise<string>;
}

/**
 * Renders one workbook block by type. Presentational blocks (text/image)
 * render their content; input blocks render an answer control wired to
 * `onAnswerChange`. The focused block gets a highlighted ring + scroll anchor.
 */
export const WorkbookBlock = React.forwardRef<HTMLDivElement, WorkbookBlockProps>(
  function WorkbookBlock(
    {
      block,
      focused,
      readOnly,
      value,
      onAnswerChange,
      onAnswerSubmit,
      onFocusClick,
      onFileUpload,
      onResolveFileUrl,
    },
    ref,
  ) {
    const t = useTranslations('live');
    const answerable = isInputBlock(block.type);

    const emit = React.useCallback(
      (next: string) => {
        if (readOnly) return;
        onAnswerChange?.(block.id, next);
      },
      [block.id, onAnswerChange, readOnly],
    );

    const submit = React.useCallback(
      (next: string) => {
        if (readOnly) return;
        (onAnswerSubmit ?? onAnswerChange)?.(block.id, next);
      },
      [block.id, onAnswerChange, onAnswerSubmit, readOnly],
    );

    const interactive = !!onFocusClick;

    return (
      <div
        ref={ref}
        id={`block-${block.id}`}
        onClick={interactive ? () => onFocusClick?.(block.id) : undefined}
        className={cn(
          'scroll-mt-24 rounded-lg border bg-card p-4 transition-all duration-300',
          focused
            ? 'z-10 border-primary ring-2 ring-primary/40 bg-primary/[0.06] shadow-md'
            : 'border-border',
          interactive && 'cursor-pointer hover:border-primary/60',
        )}
      >
        {focused && (
          <div className="mb-3 inline-flex items-center gap-1.5 rounded-md bg-primary px-2.5 py-1 text-xs font-semibold uppercase tracking-wide text-primary-foreground">
            <Eye className="h-3.5 w-3.5" />
            {t('focused')}
          </div>
        )}

        <BlockBody
          block={block}
          options={parseSelectOptions(block.options)}
          answerable={answerable}
          readOnly={readOnly}
          value={value ?? ''}
          onChange={emit}
          onSubmit={submit}
          onFileUpload={onFileUpload}
          onResolveFileUrl={onResolveFileUrl}
        />
      </div>
    );
  },
);

interface BlockBodyProps {
  block: Block;
  options: SelectOption[];
  answerable: boolean;
  readOnly?: boolean;
  value: string;
  onChange: (next: string) => void;
  onSubmit: (next: string) => void;
  onFileUpload?: (blockId: string, file: File) => Promise<void>;
  onResolveFileUrl?: (blockId: string) => Promise<string>;
}

function BlockBody({
  block,
  options,
  answerable,
  readOnly,
  value,
  onChange,
  onSubmit,
  onFileUpload,
  onResolveFileUrl,
}: BlockBodyProps) {
  const t = useTranslations('live');
  const [pending, setPending] = React.useState(value);
  const [checked, setChecked] = React.useState(false);
  const [draft, setDraft] = React.useState(value);
  const [sent, setSent] = React.useState(!!value.trim());

  React.useEffect(() => {
    setPending(value);
    setDraft(value);
    setChecked(false);
    setSent(!!value.trim());
  }, [block.id]);

  React.useEffect(() => {
    setPending(value);
    if (value.trim()) {
      setDraft(value);
      setSent(true);
    }
  }, [value]);

  switch (block.type) {
    case 'text':
      return block.content ? <RichBlockText text={block.content} /> : null;

    case 'image':
      return block.imageUrl ? (
        <ZoomableImage src={block.imageUrl} alt={block.content ?? ''} />
      ) : (
        <p className="text-sm text-muted-foreground">{block.content}</p>
      );

    case 'action_button': {
      // The editor stores the button label/href in options (not content).
      const rec =
        block.options && typeof block.options === 'object'
          ? (block.options as Record<string, unknown>)
          : {};
      const label =
        (typeof rec.label === 'string' && rec.label) ||
        block.content ||
        t('focusBlock');
      const href = typeof rec.href === 'string' ? rec.href : '';
      const embed = rec.embed === true;
      const ytId = href ? youtubeIdFromUrl(href) : null;
      if (embed && ytId) {
        return (
          <div className="space-y-2">
            <div className="aspect-video w-full overflow-hidden rounded-md border bg-black">
              <iframe
                title={label}
                src={`https://www.youtube-nocookie.com/embed/${ytId}`}
                className="h-full w-full"
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                allowFullScreen
                loading="lazy"
              />
            </div>
            <Button asChild variant="link" className="h-auto px-0">
              <a href={href} target="_blank" rel="noreferrer">
                {label}
              </a>
            </Button>
          </div>
        );
      }
      return href ? (
        <Button asChild variant="secondary">
          <a href={href} target="_blank" rel="noreferrer">
            {label}
          </a>
        </Button>
      ) : (
        <Button type="button" variant="secondary" disabled={readOnly}>
          {label}
        </Button>
      );
    }

    case 'input_text':
      return (
        <div className="space-y-2">
          {block.content && (
            <Label className="text-sm">
              <RichBlockText text={block.content} asLabel />
            </Label>
          )}
          <Textarea
            value={draft}
            disabled={readOnly}
            placeholder={t('answerPlaceholder')}
            onChange={(e) => {
              setDraft(e.target.value);
              setSent(false);
            }}
            className="min-h-[96px]"
          />
          {!readOnly ? (
            <div className="flex flex-wrap items-center gap-2">
              <Button
                type="button"
                size="sm"
                disabled={!draft.trim()}
                onClick={() => {
                  const text = draft.trim();
                  if (!text) return;
                  onSubmit(text);
                  setSent(true);
                }}
              >
                {t('submitAnswer')}
              </Button>
              {sent ? (
                <span className="text-xs font-medium text-emerald-600">
                  {t('answerSent')}
                </span>
              ) : (
                <span className="text-xs text-muted-foreground">
                  {t('submitHint')}
                </span>
              )}
            </div>
          ) : null}
        </div>
      );

    case 'input_file':
      return (
        <FileAnswerInput
          block={block}
          value={value}
          readOnly={readOnly}
          onSubmit={onSubmit}
          onFileUpload={onFileUpload}
          onResolveFileUrl={onResolveFileUrl}
        />
      );

    case 'input_rating':
      return (
        <div className="space-y-2">
          {block.content && (
            <Label className="text-sm">
              <RichBlockText text={block.content} asLabel />
            </Label>
          )}
          <div className="flex gap-1">
            {[1, 2, 3, 4, 5].map((n) => {
              const selected = value === String(n);
              return (
                <button
                  key={n}
                  type="button"
                  disabled={readOnly}
                  onClick={() => onChange(String(n))}
                  className={cn(
                    'h-9 w-9 rounded-md border text-sm font-medium transition-colors disabled:opacity-50',
                    selected
                      ? 'border-primary bg-primary text-primary-foreground'
                      : 'border-input bg-background hover:bg-accent',
                  )}
                >
                  {n}
                </button>
              );
            })}
          </div>
        </div>
      );

    case 'input_select':
    case 'test': {
      const optsRec =
        block.options && typeof block.options === 'object'
          ? (block.options as Record<string, unknown>)
          : {};
      const heading =
        block.type === 'test' &&
        typeof optsRec.question === 'string' &&
        optsRec.question
          ? optsRec.question
          : block.content;

      const correctIndex =
        typeof optsRec.correctIndex === 'number' ? optsRec.correctIndex : null;
      const correctValue =
        correctIndex != null && options[correctIndex]
          ? (options[correctIndex]!.value ??
            options[correctIndex]!.label ??
            String(correctIndex))
          : null;
      const isQuiz = block.type === 'test' && correctValue != null;

      if (block.type === 'test' && options.length === 0) {
        return (
          <div className="space-y-2">
            {heading && (
              <Label className="text-sm">
                <RichBlockText text={heading} asLabel />
              </Label>
            )}
            <Textarea
              value={value}
              disabled={readOnly}
              placeholder={t('answerPlaceholder')}
              onChange={(e) => onChange(e.target.value)}
              className="min-h-[96px]"
            />
          </div>
        );
      }

      const displayValue = isQuiz ? pending : value;

      return (
        <div className="space-y-2">
          {heading && (
            <Label className="text-sm">
              <RichBlockText text={heading} asLabel />
            </Label>
          )}
          <div className="flex flex-col gap-2">
            {options.length === 0 && (
              <p className="text-sm text-muted-foreground">{t('empty')}</p>
            )}
            {options.map((opt, i) => {
              const optValue = opt.value ?? opt.label ?? String(i);
              const selected = displayValue === optValue;
              const isCorrectOpt = correctValue != null && optValue === correctValue;
              const showResult = isQuiz && checked;
              return (
                <button
                  key={opt.id ?? optValue ?? i}
                  type="button"
                  disabled={readOnly || (isQuiz && checked)}
                  onClick={() => {
                    if (isQuiz) {
                      setPending(optValue);
                      setChecked(false);
                    } else {
                      onChange(optValue);
                    }
                  }}
                  className={cn(
                    'flex items-center gap-2 rounded-md border px-3 py-2 text-left text-sm transition-colors disabled:opacity-80',
                    showResult && isCorrectOpt &&
                      'border-emerald-500 bg-emerald-500/15 text-emerald-800 dark:text-emerald-200',
                    showResult && selected && !isCorrectOpt &&
                      'border-destructive bg-destructive/10 text-destructive',
                    !showResult && selected &&
                      'border-primary bg-primary/10',
                    !showResult && !selected &&
                      'border-input bg-background hover:bg-accent',
                  )}
                >
                  <span
                    className={cn(
                      'h-4 w-4 shrink-0 rounded-full border',
                      showResult && isCorrectOpt && 'border-emerald-500 bg-emerald-500',
                      showResult && selected && !isCorrectOpt && 'border-destructive bg-destructive',
                      !showResult && selected && 'border-primary bg-primary',
                      !showResult && !selected && 'border-input',
                    )}
                  />
                  <span className="flex-1">{opt.label ?? optValue}</span>
                  {showResult && isCorrectOpt ? (
                    <span className="text-xs font-semibold text-emerald-700 dark:text-emerald-300">
                      {t('correctAnswer')}
                    </span>
                  ) : null}
                </button>
              );
            })}
          </div>
          {isQuiz && !readOnly ? (
            <div className="space-y-2 pt-1">
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  type="button"
                  size="sm"
                  disabled={!pending}
                  onClick={() => {
                    if (!pending) return;
                    onSubmit(pending);
                    setChecked(true);
                  }}
                >
                  {t('checkAnswer')}
                </Button>
                {checked ? (
                  <span
                    className={cn(
                      'text-xs font-medium',
                      pending === correctValue
                        ? 'text-emerald-600'
                        : 'text-destructive',
                    )}
                  >
                    {pending === correctValue ? t('youCorrect') : t('youWrong')}
                  </span>
                ) : (
                  <span className="text-xs text-muted-foreground">
                    {t('checkHint')}
                  </span>
                )}
              </div>
              {checked && correctValue ? (
                <p className="rounded-md border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-900 dark:text-emerald-100">
                  <span className="font-semibold">{t('explanationLabel')}: </span>
                  {t('explanationText', { answer: correctValue })}
                </p>
              ) : null}
            </div>
          ) : null}
        </div>
      );
    }

    default:
      return answerable ? (
        <Textarea
          value={value}
          disabled={readOnly}
          placeholder={t('answerPlaceholder')}
          onChange={(e) => onChange(e.target.value)}
        />
      ) : (
        <p className="whitespace-pre-wrap text-sm text-foreground">
          {block.content}
        </p>
      );
  }
}

type FileAnswerMode = 'text' | 'link' | 'file';

interface FileAnswerInputProps {
  block: Block;
  value: string;
  readOnly?: boolean;
  onSubmit: (next: string) => void;
  onFileUpload?: (blockId: string, file: File) => Promise<void>;
  onResolveFileUrl?: (blockId: string) => Promise<string>;
}

/**
 * `input_file` answer control — three sub-modes (free text / a pasted link /
 * an uploaded file), stored in the same `answerText` column: plain text or a
 * URL as-is, an upload as `file:<key>` (see `FILE_ANSWER_PREFIX`). Once the
 * stored answer is a file reference, this renders an "attached file" chip
 * with a download action instead of the mode picker.
 */
function FileAnswerInput({
  block,
  value,
  readOnly,
  onSubmit,
  onFileUpload,
  onResolveFileUrl,
}: FileAnswerInputProps) {
  const t = useTranslations('live');
  const [mode, setMode] = React.useState<FileAnswerMode>('text');
  const [draft, setDraft] = React.useState('');
  const [uploading, setUploading] = React.useState(false);
  const [resolving, setResolving] = React.useState(false);
  const fileInputRef = React.useRef<HTMLInputElement>(null);

  const isFileAnswer = value.startsWith(FILE_ANSWER_PREFIX);

  async function handleUpload(file: File) {
    if (!onFileUpload || readOnly) return;
    setUploading(true);
    try {
      await onFileUpload(block.id, file);
    } finally {
      setUploading(false);
    }
  }

  async function handleDownload() {
    if (!onResolveFileUrl) return;
    setResolving(true);
    try {
      const url = await onResolveFileUrl(block.id);
      window.open(url, '_blank', 'noopener,noreferrer');
    } finally {
      setResolving(false);
    }
  }

  if (isFileAnswer) {
    return (
      <div className="space-y-2">
        {block.content && (
          <Label className="text-sm">
            <RichBlockText text={block.content} asLabel />
          </Label>
        )}
        <div className="flex items-center gap-2 rounded-md border bg-muted/40 px-3 py-2 text-sm">
          <Paperclip className="h-4 w-4 shrink-0 text-muted-foreground" />
          <span className="flex-1 truncate">{t('fileAttached')}</span>
          {onResolveFileUrl ? (
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={handleDownload}
              disabled={resolving}
            >
              {resolving ? <Spinner /> : null}
              {t('download')}
            </Button>
          ) : null}
        </div>
        {!readOnly && onFileUpload ? (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
          >
            {uploading ? <Spinner /> : <Upload className="h-3.5 w-3.5" />}
            {t('replaceFile')}
          </Button>
        ) : null}
        <input
          ref={fileInputRef}
          type="file"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void handleUpload(file);
            e.target.value = '';
          }}
        />
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {block.content && (
        <Label className="text-sm">
          <RichBlockText text={block.content} asLabel />
        </Label>
      )}
      {!readOnly ? (
        <div className="flex gap-1 rounded-lg bg-muted p-1 text-xs">
          {(['text', 'link', 'file'] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setMode(m)}
              className={cn(
                'flex flex-1 items-center justify-center gap-1 rounded-md px-2 py-1.5 font-medium transition-colors',
                mode === m
                  ? 'bg-background shadow-sm'
                  : 'text-muted-foreground',
              )}
            >
              {m === 'text' ? (
                <FileText className="h-3.5 w-3.5" />
              ) : m === 'link' ? (
                <Link2 className="h-3.5 w-3.5" />
              ) : (
                <Paperclip className="h-3.5 w-3.5" />
              )}
              {t(`fileMode_${m}`)}
            </button>
          ))}
        </div>
      ) : null}

      {mode === 'file' && !readOnly ? (
        <div className="space-y-1">
          <Button
            type="button"
            variant="outline"
            onClick={() => fileInputRef.current?.click()}
            disabled={!onFileUpload || uploading}
          >
            {uploading ? <Spinner /> : <Upload className="h-4 w-4" />}
            {t('chooseFile')}
          </Button>
          <input
            ref={fileInputRef}
            type="file"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void handleUpload(file);
              e.target.value = '';
            }}
          />
        </div>
      ) : (
        <>
          <Input
            type={mode === 'link' ? 'url' : 'text'}
            value={readOnly ? value : draft}
            disabled={readOnly}
            placeholder={
              mode === 'link' ? t('linkPlaceholder') : t('answerPlaceholder')
            }
            onChange={(e) => setDraft(e.target.value)}
          />
          {!readOnly ? (
            <Button
              type="button"
              size="sm"
              disabled={!draft.trim()}
              onClick={() => {
                const text = draft.trim();
                if (!text) return;
                onSubmit(text);
                setDraft('');
              }}
            >
              {t('submitAnswer')}
            </Button>
          ) : null}
        </>
      )}
    </div>
  );
}
