import { Sparkles } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * Lumen wordmark — indigo sparkle + name. Matches the .stitch design identity.
 * `size="sm"` for headers, `size="lg"` for auth/landing hero.
 */
export function Brand({
  className,
  size = 'sm',
}: {
  className?: string;
  size?: 'sm' | 'lg';
}) {
  const lg = size === 'lg';
  return (
    <span className={cn('inline-flex items-center gap-2 font-semibold', className)}>
      <Sparkles
        className={cn('text-primary', lg ? 'h-7 w-7' : 'h-5 w-5')}
        strokeWidth={2.5}
      />
      <span className={cn('tracking-tight', lg ? 'text-2xl' : 'text-lg')}>
        Lumen
      </span>
    </span>
  );
}
