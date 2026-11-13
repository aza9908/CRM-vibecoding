import { cn, withBasePath } from '@/lib/utils';

/**
 * AI Research Labs wordmark + the product name: «LMS» with «AI-powered»
 * under it, set in the same colour, weight and size as the «research labs»
 * lettering of the logo so the two read as one mark.
 *
 * The logo is a transparent PNG (no white box) so it blends with any page
 * background. `sm` = headers, `lg` = auth / landing hero.
 */
export function Brand({
  className,
  size = 'sm',
  product = true,
}: {
  className?: string;
  size?: 'sm' | 'lg';
  /** Show «LMS · AI-powered» next to the logo. */
  product?: boolean;
}) {
  const lg = size === 'lg';
  // Intrinsic asset ≈ 1344×512 (≈2.625:1). Display larger so "research labs" reads clearly.
  const height = lg ? 56 : 36;
  const width = Math.round(height * 2.625);

  return (
    <span
      className={cn('inline-flex items-stretch bg-transparent', className)}
      aria-label="AI Research Labs · LMS"
      // 1em = logo height, so the lettering below scales with the logo.
      style={{ fontSize: height }}
    >
      {/* Native <img>: keeps alpha channel clean (no Next Image wrapper bg). */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={withBasePath('/brand/ai-research-labs.png')}
        alt="AI Research Labs"
        width={width}
        height={height}
        className={cn(
          'shrink-0 bg-transparent object-contain object-left',
          lg ? 'h-14 w-auto' : 'h-9 w-auto',
        )}
        decoding="async"
      />
      {product ? (
        <span
          aria-hidden
          // Metrics measured on the logo: «research» sits at 29–58 % of its
          // height, «labs» at 62–89 %; colour #5b5bc9.
          className="-ml-[0.1em] flex flex-col justify-end whitespace-nowrap border-l border-[#5b5bc9]/30 pb-[0.045em] pl-[0.22em] font-[family-name:var(--font-brand)] font-light text-[#5b5bc9]"
        >
          <span className="block text-[0.37em] leading-[0.88]">LMS</span>
          <span className="block text-[0.37em] leading-[0.88]">AI-powered</span>
        </span>
      ) : null}
    </span>
  );
}
