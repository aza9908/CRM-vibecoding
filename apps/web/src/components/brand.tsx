import { cn } from '@/lib/utils';

/**
 * AI Research Labs wordmark — transparent PNG (no white box) so it blends
 * with any page background. `sm` = headers, `lg` = auth / landing hero.
 */
export function Brand({
  className,
  size = 'sm',
}: {
  className?: string;
  size?: 'sm' | 'lg';
}) {
  const lg = size === 'lg';
  // Intrinsic asset ≈ 1344×512 (≈2.625:1). Display larger so "research labs" reads clearly.
  const height = lg ? 56 : 36;
  const width = Math.round(height * 2.625);

  return (
    <span
      className={cn('inline-flex items-center bg-transparent', className)}
      aria-label="AI Research Labs"
    >
      {/* Native <img>: keeps alpha channel clean (no Next Image wrapper bg). */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="/brand/ai-research-labs.png"
        alt="AI Research Labs"
        width={width}
        height={height}
        className={cn(
          'bg-transparent object-contain object-left',
          lg ? 'h-14 w-auto max-w-[min(100%,22rem)]' : 'h-9 w-auto max-w-[12rem]',
        )}
        decoding="async"
      />
    </span>
  );
}
