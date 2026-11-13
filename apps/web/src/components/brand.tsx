import { cn, withBasePath } from '@/lib/utils';

/**
 * Geometry of the logo PNG (1344×512), measured on the artwork:
 *   «research»: ascender top 150, baseline 294, x-height 102
 *   «labs»:     baseline 454
 *   colour #5b5bc9
 * The product lettering is drawn in the same coordinate system, so «LMS»
 * sits exactly on the «research» baseline and «AI-powered» on the «labs»
 * baseline, with the same x-height, weight and colour.
 */
const LOGO_W = 1344;
const LOGO_H = 512;
const BASELINE_1 = 294;
const BASELINE_2 = 454;
const ASCENDER_TOP = 150;
/** 102 px x-height ÷ Lexend's x-height (0.543 em). */
const FONT_SIZE = 188;
const TEXT_X = 84;
/** «AI-powered» is 1062 units wide at this size. */
const LETTERING_W = TEXT_X + 1066;
const COLOR = '#5b5bc9';

/**
 * AI Research Labs wordmark + the product name: «LMS» with «AI-powered»
 * under it, set to read as one mark with the logo.
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
  const height = lg ? 56 : 36;
  const width = Math.round((height * LOGO_W) / LOGO_H);

  return (
    <span
      className={cn('inline-flex items-center bg-transparent', className)}
      aria-label="AI Research Labs · LMS · AI-powered"
    >
      {/* Native <img>: keeps alpha channel clean (no Next Image wrapper bg). */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={withBasePath('/brand/ai-research-labs.png')}
        alt="AI Research Labs"
        width={width}
        height={height}
        className="shrink-0 bg-transparent"
        style={{ height, width }}
        decoding="async"
      />
      {product ? (
        <svg
          aria-hidden
          viewBox={`0 0 ${LETTERING_W} ${LOGO_H}`}
          height={height}
          width={Math.round((height * LETTERING_W) / LOGO_H)}
          className="shrink-0 overflow-visible"
          style={{
            fontFamily: 'var(--font-brand), ui-sans-serif, system-ui, sans-serif',
            fontWeight: 340,
            fontSize: FONT_SIZE,
          }}
          fill={COLOR}
        >
          <line
            x1={10}
            y1={ASCENDER_TOP}
            x2={10}
            y2={BASELINE_2}
            stroke={COLOR}
            strokeOpacity={0.35}
            strokeWidth={8}
          />
          <text x={TEXT_X} y={BASELINE_1}>
            LMS
          </text>
          <text x={TEXT_X} y={BASELINE_2}>
            AI-powered
          </text>
        </svg>
      ) : null}
    </span>
  );
}
