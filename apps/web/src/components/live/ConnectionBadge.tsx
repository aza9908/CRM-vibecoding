'use client';

import { useTranslations } from 'next-intl';
import type { ConnectionStatus } from '@/lib/ws/useSessionSocket';
import { cn } from '@/lib/utils';

/** Small dot + label reflecting the Socket.IO connection state. */
export function ConnectionBadge({ status }: { status: ConnectionStatus }) {
  const t = useTranslations('live');

  const connected = status === 'connected';
  const pending = status === 'connecting' || status === 'idle';

  const label = connected
    ? t('connected')
    : pending
      ? t('connecting')
      : t('disconnected');

  const dot = connected
    ? 'bg-success'
    : pending
      ? 'bg-amber-500'
      : 'bg-destructive';

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium',
        connected
          ? 'border-success/30 bg-success/10 text-success'
          : pending
            ? 'text-muted-foreground'
            : 'border-destructive/30 bg-destructive/10 text-destructive',
      )}
    >
      <span
        className={cn(
          'h-2 w-2 rounded-full',
          dot,
          connected && 'animate-pulse',
        )}
        aria-hidden
      />
      {label}
    </span>
  );
}
