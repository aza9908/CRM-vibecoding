'use client';

import * as React from 'react';
import { PULSE_EMOJI, type PulseValue } from '@lms/shared';
import type { PulseChannel } from '@/lib/ws/pulse-channel';

interface Drop {
  id: number;
  emoji: string;
  /** Horizontal position, % of the viewport width. */
  left: number;
  /** Sideways drift while rising, px. */
  drift: number;
  size: number;
}

const MAX_ON_SCREEN = 30;
const LIFETIME_MS = 2700;

/**
 * Emoji rain of «Пульс класса»: every answer in the room makes its emoji
 * float up from the bottom edge on everyone's screen. Purely decorative:
 * pointer-events none, transform/opacity only, capped, and switched off for
 * people who prefer reduced motion.
 *
 * Keeps its own state and listens to the channel directly, so a burst of 50
 * answers re-renders only this layer, never the lesson page.
 */
export function PulseRain({ channel }: { channel: PulseChannel }) {
  const [drops, setDrops] = React.useState<Drop[]>([]);
  const nextId = React.useRef(1);

  React.useEffect(() => {
    const reduced =
      typeof window !== 'undefined' &&
      window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (reduced) return;
    const timers = new Set<number>();
    const off = channel.onReaction((value: PulseValue) => {
      const id = nextId.current++;
      const drop: Drop = {
        id,
        emoji: PULSE_EMOJI[value],
        left: 6 + Math.random() * 88,
        drift: Math.round((Math.random() - 0.5) * 120),
        size: 28 + Math.round(Math.random() * 18),
      };
      setDrops((prev) => [...prev.slice(-(MAX_ON_SCREEN - 1)), drop]);
      const timer = window.setTimeout(() => {
        timers.delete(timer);
        setDrops((prev) => prev.filter((d) => d.id !== id));
      }, LIFETIME_MS);
      timers.add(timer);
    });
    return () => {
      off();
      for (const t of timers) window.clearTimeout(t);
    };
  }, [channel]);

  if (drops.length === 0) return null;
  return (
    <div
      aria-hidden
      data-pulse-rain
      className="pointer-events-none fixed inset-0 z-[55] overflow-hidden"
    >
      {drops.map((d) => (
        <span
          key={d.id}
          data-pulse-drop
          className="absolute bottom-6 animate-float-up select-none will-change-transform"
          style={
            {
              left: `${d.left}%`,
              fontSize: d.size,
              lineHeight: 1,
              '--drift': `${d.drift}px`,
            } as React.CSSProperties
          }
        >
          {d.emoji}
        </span>
      ))}
    </div>
  );
}
