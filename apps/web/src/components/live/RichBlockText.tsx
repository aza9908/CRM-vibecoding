'use client';

import * as React from 'react';
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
  const lines = text.split('\n');
  if (asLabel) {
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

  return (
    <div className={cn('space-y-2 text-sm leading-relaxed text-foreground', className)}>
      {lines.map((line, i) => {
        if (line.trim() === '') {
          return <div key={i} className="h-2" aria-hidden />;
        }
        const isHeading = i === 0 || looksLikeHeading(line);
        return (
          <p
            key={i}
            className={cn(isHeading && 'font-bold tracking-tight', isHeading && i === 0 && 'text-base')}
          >
            {renderInline(line)}
          </p>
        );
      })}
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
