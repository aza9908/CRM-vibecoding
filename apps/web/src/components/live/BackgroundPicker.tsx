'use client';

import * as React from 'react';
import { useTranslations } from 'next-intl';
import { Ban, Sparkles } from 'lucide-react';
import { readBackgroundImage, setBackgroundImage } from '@/lib/rtc/backgroundBlur';
import { cn, withBasePath } from '@/lib/utils';

/** Virtual backgrounds shipped with the LMS (public/backgrounds). */
export const CALL_BACKGROUNDS = [
  { id: 'office', file: '/backgrounds/office.jpg' },
  { id: 'city', file: '/backgrounds/city.jpg' },
  { id: 'meadow', file: '/backgrounds/meadow.jpg' },
  { id: 'space', file: '/backgrounds/space.jpg' },
] as const;

export type BackgroundChoice = 'none' | 'blur' | string;

/** What is on now: no effect, blur, or a picture's URL. */
export function currentBackground(blurOn: boolean): BackgroundChoice {
  if (!blurOn) return 'none';
  return readBackgroundImage() ?? 'blur';
}

/**
 * One place to pick the camera background: none, blur, or one of four
 * pictures. `setEffect(on)` turns the person-cutout pipeline on or off; a
 * picture rides on the same pipeline (no restart when switching).
 */
export function BackgroundPicker({
  value,
  setEffect,
  onPicked,
  dark,
  disabled,
}: {
  value: BackgroundChoice;
  setEffect: (on: boolean) => void;
  onPicked?: (choice: BackgroundChoice) => void;
  dark?: boolean;
  disabled?: boolean;
}) {
  const t = useTranslations('videoRoom');
  const pick = (choice: BackgroundChoice) => {
    if (disabled) return;
    if (choice === 'none') {
      setBackgroundImage(null);
      setEffect(false);
    } else if (choice === 'blur') {
      setBackgroundImage(null);
      setEffect(true);
    } else {
      setBackgroundImage(choice);
      setEffect(true);
    }
    onPicked?.(choice);
  };
  const tile = (choice: BackgroundChoice, label: string, body: React.ReactNode) => {
    const on = value === choice;
    return (
      <button
        key={choice}
        type="button"
        role="radio"
        aria-checked={on}
        aria-label={label}
        title={label}
        disabled={disabled}
        onClick={() => pick(choice)}
        className={cn(
          'relative flex h-14 w-20 shrink-0 items-center justify-center overflow-hidden rounded-lg border-2 text-xs transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50',
          on ? 'border-primary ring-2 ring-primary/40' : dark ? 'border-white/15 hover:border-white/40' : 'border-border hover:border-primary/50',
          dark ? 'bg-white/5 text-white' : 'bg-muted text-foreground',
        )}
      >
        {body}
      </button>
    );
  };
  return (
    <div role="radiogroup" aria-label={t('bgTitle')} className="grid grid-cols-3 gap-2">
      {tile('none', t('bgNone'), <span className="flex flex-col items-center gap-0.5"><Ban className="h-4 w-4" />{t('bgNone')}</span>)}
      {tile('blur', t('bgBlur'), <span className="flex flex-col items-center gap-0.5"><Sparkles className="h-4 w-4" />{t('bgBlur')}</span>)}
      {CALL_BACKGROUNDS.map((b) => {
        const src = withBasePath(b.file);
        return tile(src, t(`bg_${b.id}`), (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={src} alt="" className="h-full w-full object-cover" loading="lazy" />
        ));
      })}
    </div>
  );
}
