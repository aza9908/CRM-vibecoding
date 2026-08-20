/**
 * The four answer tiles: red triangle, blue diamond, yellow circle, green
 * square, in that order.
 *
 * Colours and shape order are Kahoot's, because they are the part of the game
 * people actually navigate by — a returning player reaches for "the blue
 * diamond" without reading the text, so getting them wrong would break the
 * muscle memory the recreation exists to reproduce.
 */

export type ShapeName = 'triangle' | 'diamond' | 'circle' | 'square';

export interface AnswerStyle {
  shape: ShapeName;
  /** Tile fill. */
  color: string;
  /** Darker edge Kahoot uses as the tile's bottom border. */
  shadow: string;
  label: string;
}

export const ANSWER_STYLES: readonly [
  AnswerStyle,
  AnswerStyle,
  AnswerStyle,
  AnswerStyle,
] = [
  { shape: 'triangle', color: '#E21B3C', shadow: '#A81328', label: 'треугольник' },
  { shape: 'diamond', color: '#1368CE', shadow: '#0E4A94', label: 'ромб' },
  { shape: 'circle', color: '#D89E00', shadow: '#9C7200', label: 'круг' },
  { shape: 'square', color: '#26890C', shadow: '#1A6108', label: 'квадрат' },
];

/** Purple canvas the whole game sits on. */
export const KAHOOT_PURPLE = '#46178F';
/** Reveal colours: a brighter green/red than the answer tiles use. */
export const CORRECT_GREEN = '#66BF39';
export const WRONG_RED = '#FF3355';

/** One answer shape, as a solid white glyph sized to its container. */
export function AnswerShape({
  shape,
  className,
}: {
  shape: ShapeName;
  className?: string;
}) {
  const common = {
    className,
    viewBox: '0 0 100 100',
    fill: 'currentColor',
    'aria-hidden': true as const,
  };
  switch (shape) {
    case 'triangle':
      return (
        <svg {...common}>
          <path d="M50 8 96 88H4z" />
        </svg>
      );
    case 'diamond':
      return (
        <svg {...common}>
          <path d="M50 4 96 50 50 96 4 50z" />
        </svg>
      );
    case 'circle':
      return (
        <svg {...common}>
          <circle cx="50" cy="50" r="44" />
        </svg>
      );
    case 'square':
      return (
        <svg {...common}>
          <rect x="8" y="8" width="84" height="84" rx="4" />
        </svg>
      );
  }
}
