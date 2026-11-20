'use client';

import * as React from 'react';
import { useTranslations } from 'next-intl';
import { AlertTriangle, Check, Copy } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { cn } from '@/lib/utils';

/** Pieces shared by the «ИИ-анализ ответов» card and the «ИИ-куратор» page
 * (same look as the «ИИ-разбор урока» card). */

export function SectionTitle({
  icon: Icon,
  children,
  className,
}: {
  icon: React.ComponentType<{ className?: string }>;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <h3 className={cn('flex items-center gap-2 text-sm font-semibold', className)}>
      <Icon className="h-4 w-4 shrink-0" />
      {children}
    </h3>
  );
}

/** Copies `text()` to the clipboard and says so for a moment. */
export function CopyButton({
  text,
  label,
  doneLabel,
  iconOnly,
  variant = 'outline',
  className,
}: {
  text: () => string;
  label: string;
  doneLabel: string;
  iconOnly?: boolean;
  variant?: 'outline' | 'ghost' | 'default';
  className?: string;
}) {
  const [copied, setCopied] = React.useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text());
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      setCopied(false);
    }
  };
  return (
    <Button
      type="button"
      variant={iconOnly ? 'ghost' : variant}
      size={iconOnly ? 'icon' : 'sm'}
      onClick={() => void copy()}
      aria-label={iconOnly ? (copied ? doneLabel : label) : undefined}
      title={iconOnly ? label : undefined}
      className={cn('shrink-0 print:hidden', iconOnly && 'h-8 w-8', className)}
    >
      {copied ? <Check /> : <Copy />}
      {iconOnly ? null : copied ? doneLabel : label}
    </Button>
  );
}

/** Progress of a running job: stage label + bar. */
export function AiJobProgress({
  ns,
  stage,
  progress,
}: {
  ns: 'answersAnalysis' | 'curator';
  stage: string;
  progress: number;
}) {
  const t = useTranslations(ns);
  const key = `stage.${stage}`;
  return (
    <div className="space-y-2" role="status" aria-live="polite">
      <p className="flex items-center gap-2 text-sm font-medium">
        <Spinner className="h-4 w-4" />
        {t.has(key) ? t(key) : t('stage.queued')}
        <span className="ml-auto tabular-nums text-muted-foreground">{progress}%</span>
      </p>
      <div className="h-2 overflow-hidden rounded-full bg-muted">
        <div
          className="h-full rounded-full bg-primary transition-[width] duration-700"
          style={{ width: `${Math.max(4, progress)}%` }}
        />
      </div>
      <p className="text-xs text-muted-foreground">{t('progressHint')}</p>
    </div>
  );
}

/** A failed job, with its reason in words. */
export function AiJobFailure({ ns, error }: { ns: 'answersAnalysis' | 'curator'; error: string | null }) {
  const t = useTranslations(ns);
  const key = `errors.${error ?? 'generic'}`;
  return (
    <div
      role="alert"
      className="flex gap-3 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm"
    >
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" aria-hidden />
      <div>
        <p className="font-semibold">{t('failedTitle')}</p>
        <p className="text-xs leading-relaxed text-muted-foreground">
          {t.has(key) ? t(key) : t('errors.generic')}
        </p>
      </div>
    </div>
  );
}
