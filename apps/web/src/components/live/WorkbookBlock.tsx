'use client';

import * as React from 'react';
import { useTranslations } from 'next-intl';
import {
  Check,
  CheckCircle2,
  Brain,
  CircleAlert,
  Database,
  Download,
  ExternalLink,
  Eye,
  FileText,
  Gift,
  Handshake,
  Link2,
  Maximize2,
  Minimize2,
  ListChecks,
  Package,
  MessageSquareText,
  Palette,
  Paperclip,
  PenLine,
  Rocket,
  ShieldAlert,
  Upload,
  Workflow,
  Wrench,
  type LucideIcon,
} from 'lucide-react';
import type { Block } from '@/lib/api/types';
import { cn, withBasePath } from '@/lib/utils';
import { isInputBlock } from '@/lib/blocks';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { RichBlockText } from './RichBlockText';
import { ZoomableImage, type ZoomableImageSibling } from './ZoomableImage';
import { BoardContext } from './board-context';
import { isSelfStatusBoard, SelfStatusBoard } from './SelfStatusBoard';

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

/**
 * Who is reading the lesson. Lets text greet the student by name: `{{name}}`
 * in a text block becomes the participant's name (the page provides it).
 * `preview` = teacher view, where the placeholder is shown as a hint.
 */
export const LessonViewerContext = React.createContext<{
  name: string | null;
  preview?: boolean;
}>({ name: null });

function personalize(text: string, viewer: { name: string | null; preview?: boolean }, hint: string) {
  if (!text.includes('{{name}}')) return text;
  const name = viewer.name?.trim() || (viewer.preview ? `[${hint}]` : '');
  // «Приветствуем, {{name}}!» → without a name the comma goes too.
  return name
    ? text.replaceAll('{{name}}', name)
    : text.replace(/,?\s*\{\{name\}\}/g, '');
}

/** Text block; `blockRole: 'welcome'` renders as a greeting card. */
function TextBlockBody({ block }: { block: Block }) {
  const t = useTranslations('live');
  const viewer = React.useContext(LessonViewerContext);
  const text = personalize(block.content ?? '', viewer, t('welcomeNameHint'));
  if (block.blockRole !== 'welcome') return <RichBlockText text={text} />;
  const lines = text.split('\n');
  const title = (lines.shift() ?? '').replace(/^[#*\s]+|[*\s]+$/g, '');
  while (lines.length && !lines[0]!.trim()) lines.shift();
  const lead = (lines.shift() ?? '').replace(/^[*\s]+|[*\s]+$/g, '');
  const rest = lines.join('\n').trim();
  return (
    <div data-welcome className="-m-4 overflow-hidden rounded-[7px]">
      <div className="bg-gradient-to-br from-[#3F3D9E] via-primary to-[#8C7BE8] px-5 py-7 text-white sm:px-8 sm:py-9">
        <p className="text-2xl font-extrabold leading-tight sm:text-4xl">{title}</p>
        {lead ? <p className="mt-2 text-base leading-snug text-white/90 sm:text-xl">{lead}</p> : null}
      </div>
      {rest ? (
        <div className="space-y-4 px-5 py-5 sm:px-8 sm:py-6">
          {rest.split(/\n{2,}/).map((para, i) => {
            const Icon = welcomeIcon(para);
            const heading = /^\*\*[^*]+\*\*$/.test(para.trim());
            const body = heading ? (
              <p className="text-base font-bold tracking-tight">{para.trim().slice(2, -2)}</p>
            ) : (
              <RichBlockText text={para} noHeading />
            );
            if (!Icon) return <React.Fragment key={i}>{body}</React.Fragment>;
            return (
              <div key={i} data-welcome-row className="flex items-start gap-3">
                <span
                  aria-hidden
                  className={cn(
                    'flex shrink-0 items-center justify-center rounded-xl bg-primary text-primary-foreground',
                    heading ? 'h-10 w-10' : 'h-9 w-9 bg-primary/10 text-primary',
                  )}
                >
                  <Icon className={heading ? 'h-5 w-5' : 'h-[18px] w-[18px]'} strokeWidth={2} />
                </span>
                <div className={cn('min-w-0 flex-1', heading ? 'pt-2' : 'pt-1.5')}>{body}</div>
              </div>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

/** Icons for the bold lines of the welcome card, matched by their opening words. */
const WELCOME_ICONS: [RegExp, LucideIcon][] = [
  [/^\*\*(Как устроен|Программа|Как проходит)/i, Workflow],
  [/^\*\*(Что останется|Результат|Что вы получите)/i, Gift],
  [/^\*\*Продукт/i, Package],
  [/^\*\*Знани/i, Brain],
  [/^\*\*Навык/i, Wrench],
];
function welcomeIcon(para: string): LucideIcon | null {
  const p = para.trim();
  for (const [re, Icon] of WELCOME_ICONS) if (re.test(p)) return Icon;
  return null;
}

export interface WorkbookBlockProps {
  block: Block;
  /** Whether this block is the one the teacher is currently focusing. */
  focused?: boolean;
  /** Read-only mode (teacher preview): inputs are disabled, no answers sent. */
  readOnly?: boolean;
  /** Current student answer for this block (controlled). */
  value?: string;
  /** The student has submitted this exercise — shows the «Сдано ✓» tick. */
  done?: boolean;
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
  /** `image` blocks only: every image block in the same lesson plus this
   * one's position among them, so the fullscreen lightbox can page to the
   * next/previous slide instead of only showing this single image. Pass
   * `undefined` (the default) for single-image contexts. */
  imageNav?: { images: ZoomableImageSibling[]; index: number };
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
      done,
      readOnly,
      value,
      onAnswerChange,
      onAnswerSubmit,
      onFocusClick,
      onFileUpload,
      onResolveFileUrl,
      imageNav,
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
    const showDone = !!done && answerable && !readOnly;

    return (
      <div
        ref={ref}
        id={`block-${block.id}`}
        onClick={interactive ? () => onFocusClick?.(block.id) : undefined}
        className={cn(
          'scroll-mt-24 rounded-lg border bg-card p-4 transition-all duration-300',
          focused
            ? 'z-10 border-primary ring-2 ring-primary/40 bg-primary/[0.06] shadow-md'
            : showDone
              ? 'border-success/50'
              : 'border-border',
          interactive && 'cursor-pointer hover:border-primary/60',
        )}
      >
        {showDone ? (
          <div className="mb-3 mr-2 inline-flex items-center gap-1.5 rounded-md bg-success/15 px-2.5 py-1 text-xs font-semibold text-success">
            <CheckCircle2 className="h-3.5 w-3.5" />
            {t('blockDone')}
          </div>
        ) : null}
        {answerable && !readOnly && !done && isRequiredBlock(block.options) ? (
          <div className="mb-3 mr-2 inline-flex items-center gap-1.5 rounded-md bg-destructive/10 px-2.5 py-1 text-xs font-semibold text-destructive">
            <CircleAlert className="h-3.5 w-3.5" />
            {t('blockRequired')}
          </div>
        ) : null}
        {focused && (
          <div className="mb-3 inline-flex items-center gap-1.5 rounded-md bg-primary px-2.5 py-1 text-xs font-semibold uppercase tracking-wide text-primary-foreground">
            <Eye className="h-3.5 w-3.5" />
            {t('focused')}
          </div>
        )}

        <BlockWithIcon icon={blockIcon(block.options)}>
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
          imageNav={imageNav}
        />
        </BlockWithIcon>
      </div>
    );
  },
);

/** Puts the block's icon tile beside its content, like the deck's level rows. */
function BlockWithIcon({
  icon: Icon,
  children,
}: {
  icon: LucideIcon | null;
  children: React.ReactNode;
}) {
  if (!Icon) return <>{children}</>;
  return (
    <div className="flex items-start gap-3 sm:gap-4">
      <span
        aria-hidden
        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary text-primary-foreground sm:h-11 sm:w-11"
      >
        <Icon className="h-5 w-5" strokeWidth={2} />
      </span>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

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
  imageNav?: { images: ZoomableImageSibling[]; index: number };
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
  imageNav,
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
      return block.content ? <TextBlockBody block={block} /> : null;

    case 'image': {
      const video = blockVideoSrc(block.options);
      if (video) {
        return (
          <LessonVideo
            src={video}
            poster={block.imageUrl ?? undefined}
            caption={block.content ?? ''}
            frame={blockVideoFrame(block.options)}
          />
        );
      }
      return block.imageUrl ? (
        <ZoomableImage
          src={block.imageUrl}
          alt={block.content ?? ''}
          siblings={imageNav?.images}
          index={imageNav?.index}
        />
      ) : (
        <p className="text-sm text-muted-foreground">{block.content}</p>
      );
    }

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
        <Button asChild variant="secondary" className="h-auto min-h-9 max-w-full whitespace-normal py-2 text-left">
          <a href={href} target="_blank" rel="noreferrer">
            {label}
          </a>
        </Button>
      ) : (
        <Button type="button" variant="secondary" disabled={readOnly} className="h-auto min-h-9 max-w-full whitespace-normal py-2 text-left">
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
                <span className="inline-flex items-center gap-1 text-xs font-medium text-success">
                  <Check className="h-3.5 w-3.5" />
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

    case 'status_board':
      if (isSelfStatusBoard(block)) {
        return <SelfStatusBoard block={block} value={value} readOnly={readOnly} onChange={(_id, next) => onChange(next)} />;
      }
      return <StatusBoard block={block} />;

    case 'checklist':
      return (
        <ChecklistBlockBody
          block={block}
          value={value}
          readOnly={readOnly}
          onChange={onChange}
        />
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

interface ChecklistItemOption {
  text: string;
  url?: string;
}

/** Read a `checklist` block's items from its `options` payload. */
function parseChecklistItems(options: unknown): ChecklistItemOption[] {
  if (!options || typeof options !== 'object') return [];
  const items = (options as Record<string, unknown>).items;
  if (!Array.isArray(items)) return [];
  return items
    .map((v) => {
      if (typeof v === 'string') return { text: v };
      if (v && typeof v === 'object') {
        const o = v as Record<string, unknown>;
        return {
          text: typeof o.text === 'string' ? o.text : '',
          url: typeof o.url === 'string' && o.url ? o.url : undefined,
        };
      }
      return null;
    })
    .filter((x): x is ChecklistItemOption => !!x && x.text.length > 0);
}

/** Parse the checked-index set stored in `answerText` (JSON array of numbers). */
function parseCheckedIndices(value: string): Set<number> {
  try {
    const parsed: unknown = JSON.parse(value);
    if (Array.isArray(parsed)) {
      return new Set(parsed.filter((x): x is number => typeof x === 'number'));
    }
  } catch {
    /* no saved state yet */
  }
  return new Set();
}

/**
 * `checklist` block — a readiness/todo list with real checkboxes (replacing
 * the earlier workaround of one `input_select` block per item). Each item is
 * a label with an optional instruction link (e.g. a download page or video).
 * Checked state is stored as a JSON array of indices in `answerText`.
 */
function ChecklistBlockBody({
  block,
  value,
  readOnly,
  onChange,
}: {
  block: Block;
  value: string;
  readOnly?: boolean;
  onChange: (next: string) => void;
}) {
  const t = useTranslations('live');
  const items = React.useMemo(() => parseChecklistItems(block.options), [block.options]);
  const checked = React.useMemo(() => parseCheckedIndices(value), [value]);

  function toggle(index: number) {
    if (readOnly) return;
    const next = new Set(checked);
    if (next.has(index)) next.delete(index);
    else next.add(index);
    onChange(JSON.stringify([...next].sort((a, b) => a - b)));
  }

  return (
    <div className="space-y-2">
      {block.content && (
        <Label className="text-sm">
          <RichBlockText text={block.content} asLabel />
        </Label>
      )}
      <ul className="flex flex-col gap-1.5">
        {items.map((item, i) => {
          const isChecked = checked.has(i);
          return (
            <li key={i} className="flex items-center gap-2">
              <button
                type="button"
                role="checkbox"
                aria-checked={isChecked}
                disabled={readOnly}
                onClick={() => toggle(i)}
                className={cn(
                  'flex h-5 w-5 shrink-0 items-center justify-center rounded border transition-colors disabled:opacity-60',
                  isChecked
                    ? 'border-primary bg-primary text-primary-foreground'
                    : 'border-input bg-background hover:bg-accent',
                )}
              >
                {isChecked ? <Check className="h-3.5 w-3.5" /> : null}
              </button>
              <span
                className={cn(
                  'flex-1 text-sm',
                  isChecked && 'text-muted-foreground line-through',
                )}
              >
                {item.text}
              </span>
              {item.url ? (
                <a
                  href={item.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="shrink-0 text-muted-foreground hover:text-primary"
                  aria-label={item.text}
                >
                  <ExternalLink className="h-3.5 w-3.5" />
                </a>
              ) : null}
            </li>
          );
        })}
      </ul>
      {items.length > 0 ? (
        <p className="text-xs text-muted-foreground">
          {t('checklistProgress', { checked: checked.size, total: items.length })}
        </p>
      ) : null}
    </div>
  );
}

/** `options.required` marks an answer block the student must complete. */
function isRequiredBlock(options: unknown): boolean {
  return (
    !!options &&
    typeof options === 'object' &&
    (options as Record<string, unknown>).required === true
  );
}

/** An `image` block with `options.video` plays that file; `imageUrl` is its poster. */
function blockVideoSrc(options: unknown): string | null {
  if (!options || typeof options !== 'object') return null;
  const v = (options as Record<string, unknown>).video;
  return typeof v === 'string' && (v.startsWith('/') || /^https?:\/\//i.test(v))
    ? v
    : null;
}

/** Where the clip sits on its slide, in percent of the slide (`options.frame`). */
interface VideoFrame {
  left: number;
  top: number;
  width: number;
  height: number;
}
function blockVideoFrame(options: unknown): VideoFrame | null {
  if (!options || typeof options !== 'object') return null;
  const f = (options as Record<string, unknown>).frame as Record<string, unknown> | undefined;
  if (!f || typeof f !== 'object') return null;
  const n = (k: string) => (typeof f[k] === 'number' ? (f[k] as number) : NaN);
  const frame = { left: n('left'), top: n('top'), width: n('width'), height: n('height') };
  return Object.values(frame).every((v) => Number.isFinite(v) && v >= 0 && v <= 100)
    ? frame
    : null;
}

/**
 * A lesson animation that behaves like a GIF: it starts by itself when it
 * scrolls into view, loops, and stops when it leaves the screen. The file is
 * not downloaded until the clip is near the viewport (`preload="none"`), so a
 * class opening the lesson at once does not pull every clip from the server.
 *
 * With `frame`, the clip plays inside its slide (`poster` is the slide image);
 * without it, the clip is shown on its own and `poster` is its first frame.
 */
function LessonVideo({
  src,
  poster,
  caption,
  frame,
}: {
  src: string;
  poster?: string;
  caption: string;
  frame?: VideoFrame | null;
}) {
  const t = useTranslations('live');
  const ref = React.useRef<HTMLVideoElement>(null);
  const boxRef = React.useRef<HTMLDivElement>(null);
  const [full, setFull] = React.useState(false);

  React.useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            // Autoplay can be refused (data saver, low power mode): the poster
            // stays and a tap on the clip starts it.
            void el.play().catch(() => undefined);
          } else if (document.fullscreenElement !== boxRef.current) {
            el.pause();
          }
        }
      },
      { rootMargin: '200px 0px', threshold: 0.01 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [src]);

  React.useEffect(() => {
    const onChange = () => setFull(document.fullscreenElement === boxRef.current);
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);

  const toggle = (e: React.MouseEvent<HTMLVideoElement>) => {
    e.stopPropagation();
    const el = e.currentTarget;
    if (el.paused) void el.play().catch(() => undefined);
    else el.pause();
  };

  const toggleFull = (e: React.MouseEvent) => {
    e.stopPropagation();
    const box = boxRef.current;
    const video = ref.current;
    if (document.fullscreenElement) {
      void document.exitFullscreen().catch(() => undefined);
      return;
    }
    if (box?.requestFullscreen) {
      void box
        .requestFullscreen()
        .then(() => video && void video.play().catch(() => undefined))
        .catch(() => undefined);
      return;
    }
    // iPhone Safari has no element fullscreen: use the video's own player.
    const ios = video as (HTMLVideoElement & { webkitEnterFullscreen?: () => void }) | null;
    ios?.webkitEnterFullscreen?.();
  };

  const video = (
    <video
      ref={ref}
      data-lesson-video
      src={withBasePath(src)}
      poster={frame ? undefined : withBasePath(poster)}
      aria-label={caption}
      loop
      muted
      playsInline
      preload="none"
      disablePictureInPicture
      onClick={toggle}
      className={
        frame
          ? 'absolute rounded-[1.2%] object-cover'
          : full
            ? 'block h-full w-full object-contain'
            : 'block h-auto w-full'
      }
      style={
        frame
          ? {
              left: `${frame.left}%`,
              top: `${frame.top}%`,
              width: `${frame.width}%`,
              height: `${frame.height}%`,
            }
          : undefined
      }
    />
  );

  const fullButton = (
    <button
      type="button"
      data-video-fullscreen
      onClick={toggleFull}
      className="absolute bottom-2 right-2 z-10 inline-flex items-center gap-1.5 rounded-md border bg-background/95 px-2.5 py-1.5 text-xs font-medium text-foreground shadow-sm hover:bg-background"
      aria-label={full ? t('zoomCollapse') : t('zoomOpen')}
    >
      {full ? <Minimize2 className="h-3.5 w-3.5" /> : <Maximize2 className="h-3.5 w-3.5" />}
      {full ? t('zoomCollapse') : t('zoomOpen')}
    </button>
  );

  if (frame && poster) {
    // In fullscreen the slide keeps its proportions, so the clip stays in place.
    return (
      <div
        ref={boxRef}
        className={cn(
          'relative overflow-hidden rounded-md border bg-card',
          full && 'flex items-center justify-center rounded-none border-0 bg-white',
        )}
      >
        <div className={cn('relative w-full', full && 'w-[min(100vw,177.78vh)]')}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={withBasePath(poster)} alt={caption} className="block h-auto w-full" />
          {video}
        </div>
        {fullButton}
      </div>
    );
  }
  return (
    <div
      ref={boxRef}
      className={cn(
        'relative overflow-hidden rounded-md border bg-black',
        full && 'flex items-center justify-center rounded-none border-0',
      )}
    >
      {video}
      {fullButton}
    </div>
  );
}

/** Line icons for task and question blocks (`options.icon`). */
const BLOCK_ICONS: Record<string, LucideIcon> = {
  pen: PenLine,
  question: MessageSquareText,
  checklist: ListChecks,
  tools: Wrench,
  palette: Palette,
  database: Database,
  rocket: Rocket,
  download: Download,
  alert: ShieldAlert,
  handshake: Handshake,
};

function blockIcon(options: unknown): LucideIcon | null {
  if (!options || typeof options !== 'object') return null;
  const name = (options as Record<string, unknown>).icon;
  return typeof name === 'string' ? (BLOCK_ICONS[name] ?? null) : null;
}

interface BoardColumn {
  label: string;
  title?: string;
}
interface BoardRow {
  label: string;
  sub?: string;
}

/**
 * A status board: one row per person/project, one column per stage. The
 * teacher ticks a cell (one per row; clicking it again clears the row) and
 * every screen in the session updates at once. Students see it read-only.
 */
function StatusBoard({ block }: { block: Block }) {
  const t = useTranslations('live');
  const ctx = React.useContext(BoardContext);
  const o = (block.options ?? {}) as {
    columns?: (string | BoardColumn)[];
    rows?: (string | BoardRow)[];
    rowHeader?: string;
    subHeader?: string;
  };
  const columns: BoardColumn[] = (o.columns ?? []).map((c) => (typeof c === 'string' ? { label: c } : c));
  const rows: BoardRow[] = (o.rows ?? []).map((r) => (typeof r === 'string' ? { label: r } : r));
  const state = ctx.boards[block.id] ?? {};
  const editable = !!ctx.onSet;
  const counts = columns.map((_, ci) => Object.values(state).filter((v) => v === ci).length);
  const marked = Object.keys(state).length;

  return (
    <div className="space-y-3" data-status-board>
      {block.content ? (
        <div className="text-sm">
          <RichBlockText text={block.content} asLabel />
        </div>
      ) : null}
      <p className="text-xs text-muted-foreground">
        {editable ? t('boardHintTeacher') : t('boardHintStudent')} · {t('boardMarked', { marked, total: rows.length })}
      </p>
      <div className="-mx-1 overflow-x-auto px-1">
        <table className="w-full min-w-[300px] border-separate border-spacing-0 text-sm sm:min-w-[640px]">
          <thead>
            <tr>
              <th className="sticky left-0 z-10 w-8 rounded-tl-md bg-primary px-2 py-2 text-left text-xs font-semibold text-primary-foreground">№</th>
              <th className="bg-primary px-2 py-2 text-left text-xs font-semibold text-primary-foreground">{o.rowHeader ?? t('boardName')}</th>
              {o.subHeader !== '' ? (
                <th className="hidden bg-primary px-2 py-2 text-left text-xs font-semibold text-primary-foreground sm:table-cell">{o.subHeader ?? t('boardProject')}</th>
              ) : null}
              {columns.map((c, ci) => (
                <th
                  key={ci}
                  title={c.title}
                  className={cn('bg-primary px-0.5 py-2 text-center text-xs font-semibold text-primary-foreground sm:px-1', ci === columns.length - 1 && 'rounded-tr-md')}
                >
                  <div className="leading-none">{c.label}</div>
                  {c.title ? <div className="mt-0.5 hidden text-[10px] font-normal opacity-80 md:block">{c.title}</div> : null}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, ri) => {
              const sel = state[String(ri)];
              return (
                <tr key={ri} className="even:bg-muted/30" data-board-row={ri}>
                  <td className="sticky left-0 border-b bg-card px-1.5 py-2 text-xs text-muted-foreground sm:px-2">{ri + 1}</td>
                  <td className="border-b px-1.5 py-2 text-[13px] font-medium leading-tight sm:px-2 sm:text-sm">{r.label}</td>
                  {o.subHeader !== '' ? (
                    <td className="hidden whitespace-pre-line border-b px-2 py-2 text-xs text-muted-foreground sm:table-cell">{r.sub ?? ''}</td>
                  ) : null}
                  {columns.map((c, ci) => {
                    const on = sel === ci;
                    return (
                      <td key={ci} className="border-b px-0.5 py-1.5 text-center sm:px-1">
                        <button
                          type="button"
                          role="radio"
                          aria-checked={on}
                          aria-label={`${r.label}: ${c.title ?? c.label}`}
                          data-board-cell={`${ri}:${ci}`}
                          disabled={!editable}
                          onClick={(e) => {
                            e.stopPropagation();
                            ctx.onSet?.(block.id, ri, on ? null : ci);
                          }}
                          className={cn(
                            'inline-flex h-6 w-6 items-center justify-center rounded-full border transition-colors sm:h-7 sm:w-7',
                            on
                              ? 'border-primary bg-primary text-primary-foreground'
                              : 'border-input bg-background',
                            editable && !on && 'hover:border-primary hover:bg-primary/10',
                            !editable && 'cursor-default',
                          )}
                        >
                          {on ? <Check className="h-4 w-4" /> : null}
                        </button>
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr>
              <td className="sticky left-0 bg-card px-2 py-2" />
              <td className="px-2 py-2 text-xs font-semibold text-muted-foreground">{t('boardTotal')}</td>
              {o.subHeader !== '' ? <td className="hidden sm:table-cell" /> : null}
              {counts.map((n, ci) => (
                <td key={ci} className="px-1 py-2 text-center text-xs font-bold tabular-nums">{n || ''}</td>
              ))}
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}
