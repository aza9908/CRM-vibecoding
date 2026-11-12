'use client';

import * as React from 'react';
import { useTranslations } from 'next-intl';
import { Check, Copy, FileText, MessageSquareText } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * Renders workbook text with:
 * - first line as a bold heading
 * - `**bold**` markdown spans
 * - preserved line breaks
 */
export function RichBlockText({
  text,
  className,
  asLabel,
}: {
  text: string;
  className?: string;
  /** When true, render as a single label (input prompts) without splitting layout. */
  asLabel?: boolean;
}) {
  if (asLabel) {
    const lines = text.split('\n');
    return (
      <span className={cn('text-sm font-medium leading-relaxed', className)}>
        {lines.map((line, i) => (
          <React.Fragment key={i}>
            {i > 0 ? <br /> : null}
            {i === 0 ? (
              <span className="font-bold">{renderInline(line)}</span>
            ) : (
              renderInline(line)
            )}
          </React.Fragment>
        ))}
      </span>
    );
  }

  // Paragraphs that start with «ПРОМПТ · / PROMPT · / ФАЙЛ · / FAYL ·» are
  // real prompts and files: show them as a copyable monospace box.
  const paragraphs = text.split(/\n{2,}/);
  let lineNo = 0;
  return (
    <div className={cn('space-y-2 text-sm leading-relaxed text-foreground', className)}>
      {paragraphs.map((para, pi) => {
        const paraLines = para.split('\n');
        const first = (paraLines[0] ?? '').replace(/\*\*/g, '').trim();
        const kind = CODE_HEAD.exec(first)?.[1];
        const startLine = lineNo;
        lineNo += paraLines.length;
        const spacer = pi > 0 ? <div className="h-2" aria-hidden /> : null;
        if (kind) {
          return (
            <React.Fragment key={pi}>
              {spacer}
              <CodeBox
                title={first}
                body={paraLines.slice(1).join('\n')}
                isPrompt={/^(ПРОМПТ|PROMPT)/i.test(kind)}
              />
            </React.Fragment>
          );
        }
        return (
          <React.Fragment key={pi}>
            {spacer}
            {paraLines.map((line, li) => {
              const i = startLine + li;
              if (line.trim() === '') {
                return <div key={li} className="h-2" aria-hidden />;
              }
              const isHeading = i === 0 || looksLikeHeading(line);
              return (
                <p
                  key={li}
                  className={cn(isHeading && 'font-bold tracking-tight', isHeading && i === 0 && 'text-base')}
                >
                  {renderInline(line)}
                </p>
              );
            })}
          </React.Fragment>
        );
      })}
    </div>
  );
}

const CODE_HEAD = /^(ПРОМПТ|PROMPT|ФАЙЛ|FAYL)\s*·/i;

/** A real prompt or file from the lesson, with a one-click copy button. */
function CodeBox({ title, body, isPrompt }: { title: string; body: string; isPrompt: boolean }) {
  const t = useTranslations('common');
  const [copied, setCopied] = React.useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(body);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard blocked — the text can still be selected by hand */
    }
  };
  return (
    <div
      className={cn(
        'overflow-hidden rounded-lg border',
        isPrompt ? 'border-primary/40 bg-primary/5' : 'border-border bg-muted/60',
      )}
    >
      <div className="flex items-center gap-2 border-b border-inherit px-3 py-2">
        {isPrompt ? (
          <MessageSquareText className="h-4 w-4 shrink-0 text-primary" aria-hidden />
        ) : (
          <FileText className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
        )}
        <span className="min-w-0 flex-1 text-xs font-semibold">{title}</span>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            void copy();
          }}
          className={cn(
            'inline-flex shrink-0 items-center gap-1 rounded-md border bg-card px-2 py-1 text-xs font-medium transition-colors hover:bg-accent',
            copied && 'border-success text-success',
          )}
        >
          {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
          {copied ? t('copied') : t('copy')}
        </button>
      </div>
      <pre className="whitespace-pre-wrap break-words px-3 py-3 font-mono text-[13px] leading-relaxed text-foreground sm:text-sm">
        {body}
      </pre>
    </div>
  );
}

function looksLikeHeading(line: string): boolean {
  const t = line.trim();
  if (t.length < 4 || t.length > 90) return false;
  // All-caps-ish headers / section labels common in the workbook seed.
  if (/^(ТОЧКА|БЛОК|ЦЕЛЬ|ПРАВИЛА|ЗАПОМНИТЬ|УПРАЖНЕНИЕ|ЗАДАНИЕ|ЗАДАЧА|ФИДБЭК|ИТОГ|YOLO|PROMPT|NOTEBOOK)/i.test(t)) {
    return true;
  }
  return false;
}

function renderInline(line: string): React.ReactNode[] {
  const parts = line.split(/(\*\*[^*]+\*\*)/g);
  return parts.map((part, i) => {
    if (part.startsWith('**') && part.endsWith('**') && part.length > 4) {
      return (
        <strong key={i} className="font-semibold">
          {part.slice(2, -2)}
        </strong>
      );
    }
    return <React.Fragment key={i}>{part}</React.Fragment>;
  });
}
