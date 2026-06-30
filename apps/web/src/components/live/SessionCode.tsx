'use client';

import * as React from 'react';
import { useTranslations } from 'next-intl';
import { Check, Copy } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

/** Big copyable session code shown to the teacher to share with students. */
export function SessionCode({ code }: { code: string }) {
  const t = useTranslations('live');
  const tc = useTranslations('common');
  const [copied, setCopied] = React.useState(false);

  const copy = React.useCallback(async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  }, [code]);

  return (
    <div className="flex flex-col gap-1">
      <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        {t('sessionCode')}
      </span>
      <div className="flex items-center gap-2">
        <span className="rounded-lg border bg-muted px-4 py-1.5 font-mono text-3xl font-bold leading-none tracking-[0.3em] text-foreground">
          {code}
        </span>
        <Button
          type="button"
          variant="outline"
          size="icon"
          onClick={copy}
          aria-label={tc('copy')}
        >
          <Check
            className={cn(
              'h-4 w-4 text-success transition-opacity',
              copied ? 'opacity-100' : 'hidden opacity-0',
            )}
          />
          <Copy className={cn('h-4 w-4', copied && 'hidden')} />
        </Button>
      </div>
      <span className="text-xs text-muted-foreground">{t('shareCode')}</span>
    </div>
  );
}
