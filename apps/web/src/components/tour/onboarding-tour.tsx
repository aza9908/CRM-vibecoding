'use client';

import { useEffect, useLayoutEffect, useState, type CSSProperties } from 'react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';

/** One step of an interactive tour: the element to highlight + its caption. */
export interface TourStep {
  /** Matches a `data-tour-id` attribute somewhere in the DOM. */
  targetId: string;
  text: string;
}

interface OnboardingTourProps {
  steps: TourStep[];
  open: boolean;
  /** Called once, whether the tour was completed or skipped early. */
  onFinish: () => void;
}

const HIGHLIGHT_PADDING = 8;
const CARD_WIDTH = 288;
const CARD_GAP = 16;

/**
 * Interactive first-login onboarding tour (TZ_LMS_roles_promocodes.md §6.4,
 * layer 1): dims the screen, highlights one `data-tour-id`-tagged element at
 * a time with a one-sentence caption, and advances via Далее/Пропустить.
 */
export function OnboardingTour({ steps, open, onFinish }: OnboardingTourProps) {
  const t = useTranslations('tour');
  const [stepIndex, setStepIndex] = useState(0);
  const [rect, setRect] = useState<DOMRect | null>(null);

  useEffect(() => {
    if (open) setStepIndex(0);
  }, [open]);

  const step = open ? steps[stepIndex] : undefined;

  const targetId = step?.targetId;

  useLayoutEffect(() => {
    if (!targetId) return;
    function measure() {
      const el = document.querySelector(`[data-tour-id="${targetId}"]`);
      if (el) {
        el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        setRect(el.getBoundingClientRect());
      } else {
        setRect(null);
      }
    }
    measure();
    window.addEventListener('resize', measure);
    window.addEventListener('scroll', measure, true);
    return () => {
      window.removeEventListener('resize', measure);
      window.removeEventListener('scroll', measure, true);
    };
    // Keyed on the target id (a primitive), not the `step` object — the
    // caller rebuilds `steps` on every render, so keying on object identity
    // would re-measure (and re-trigger the smooth scroll) on any unrelated
    // parent re-render while the tour is open, not just on step changes.
  }, [targetId]);

  if (!step) return null;

  const isLast = stepIndex === steps.length - 1;

  function next() {
    if (isLast) {
      onFinish();
    } else {
      setStepIndex((i) => i + 1);
    }
  }

  const box = rect
    ? {
        top: rect.top - HIGHLIGHT_PADDING,
        left: rect.left - HIGHLIGHT_PADDING,
        width: rect.width + HIGHLIGHT_PADDING * 2,
        height: rect.height + HIGHLIGHT_PADDING * 2,
      }
    : null;

  let cardStyle: CSSProperties;
  if (box) {
    const fitsRight =
      box.left + box.width + CARD_GAP + CARD_WIDTH < window.innerWidth;
    cardStyle = fitsRight
      ? {
          top: Math.max(16, Math.min(box.top, window.innerHeight - 200)),
          left: box.left + box.width + CARD_GAP,
        }
      : {
          top: Math.min(box.top + box.height + CARD_GAP, window.innerHeight - 200),
          left: Math.max(16, box.left),
        };
  } else {
    cardStyle = { top: '50%', left: '50%', transform: 'translate(-50%, -50%)' };
  }

  return (
    <div className="fixed inset-0 z-[100]" role="dialog" aria-modal="true">
      {box ? (
        <div
          className="pointer-events-none absolute rounded-lg ring-2 ring-primary transition-all duration-200"
          style={{
            top: box.top,
            left: box.left,
            width: box.width,
            height: box.height,
            boxShadow: '0 0 0 9999px rgba(0,0,0,0.6)',
          }}
        />
      ) : (
        <div className="absolute inset-0 bg-black/60" />
      )}
      <div
        className="absolute rounded-lg border bg-card p-4 shadow-xl"
        style={{ width: CARD_WIDTH, ...cardStyle }}
      >
        <p className="text-sm text-foreground">{step.text}</p>
        <div className="mt-4 flex items-center justify-between">
          <span className="text-xs text-muted-foreground">
            {stepIndex + 1} / {steps.length}
          </span>
          <div className="flex gap-2">
            <Button type="button" variant="ghost" size="sm" onClick={onFinish}>
              {t('skip')}
            </Button>
            <Button type="button" size="sm" onClick={next}>
              {isLast ? t('finish') : t('next')}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
