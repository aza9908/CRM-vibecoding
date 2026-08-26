'use client';

import * as React from 'react';
import { createPortal } from 'react-dom';
import { useTranslations } from 'next-intl';
import { Maximize2, Minimize2, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

/**
 * Lesson image with YouTube-like fullscreen (no +/- zoom).
 * Portaled to document.body + Fullscreen API so LMS chrome cannot show through.
 */
export function ZoomableImage({
  src,
  alt,
  className,
}: {
  src: string;
  alt?: string;
  className?: string;
}) {
  const t = useTranslations('live');
  const [open, setOpen] = React.useState(false);
  const [mounted, setMounted] = React.useState(false);
  const overlayRef = React.useRef<HTMLDivElement>(null);

  const close = React.useCallback(() => {
    const exit = document.exitFullscreen?.();
    if (exit) {
      void exit.catch(() => undefined);
    }
    setOpen(false);
  }, []);

  React.useEffect(() => {
    setMounted(true);
  }, []);

  React.useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    const onFsChange = () => {
      // User pressed Esc / browser UI to leave native fullscreen.
      if (!document.fullscreenElement) setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('fullscreenchange', onFsChange);
    const prevOverflow = document.body.style.overflow;
    const prevPaddingRight = document.body.style.paddingRight;
    const scrollbar = window.innerWidth - document.documentElement.clientWidth;
    document.body.style.overflow = 'hidden';
    if (scrollbar > 0) {
      document.body.style.paddingRight = `${scrollbar}px`;
    }

    const el = overlayRef.current;
    if (el && el.requestFullscreen && !document.fullscreenElement) {
      void el.requestFullscreen().catch(() => {
        // Fallback: fixed overlay still covers the viewport.
      });
    }

    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('fullscreenchange', onFsChange);
      document.body.style.overflow = prevOverflow;
      document.body.style.paddingRight = prevPaddingRight;
      if (document.fullscreenElement) {
        void document.exitFullscreen().catch(() => undefined);
      }
    };
  }, [open, close]);

  const lightbox =
    open && mounted
      ? createPortal(
          <div
            ref={overlayRef}
            role="dialog"
            aria-modal="true"
            aria-label={t('zoomImage')}
            className="fixed inset-0 z-[9999] flex h-[100dvh] w-screen flex-col bg-black"
            onClick={close}
          >
            <div
              className="absolute inset-x-0 top-0 z-10 flex items-center justify-end gap-2 bg-gradient-to-b from-black/80 to-transparent px-3 py-3"
              onClick={(e) => e.stopPropagation()}
            >
              <Button
                type="button"
                size="icon"
                variant="secondary"
                className="h-9 w-9 bg-white text-foreground hover:bg-white/90"
                onClick={close}
                aria-label={t('zoomCollapse')}
                title={t('zoomCollapse')}
              >
                <Minimize2 className="h-4 w-4" />
              </Button>
              <Button
                type="button"
                size="icon"
                variant="secondary"
                className="h-9 w-9 bg-white text-foreground hover:bg-white/90"
                onClick={close}
                aria-label={t('zoomClose')}
                title={t('zoomClose')}
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
            <div className="flex h-full w-full items-center justify-center overflow-hidden p-0">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={src}
                alt={alt ?? ''}
                className="h-full w-full object-contain"
                onClick={(e) => e.stopPropagation()}
                draggable={false}
              />
            </div>
          </div>,
          document.body,
        )
      : null;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="group relative block w-full cursor-pointer text-left"
        aria-label={t('zoomOpen')}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={src}
          alt={alt ?? ''}
          className={cn(
            'h-auto w-full max-w-full rounded-md border object-contain',
            className,
          )}
          loading="lazy"
          decoding="async"
        />
        <span className="pointer-events-none absolute bottom-3 right-3 inline-flex items-center gap-1.5 rounded-md bg-background/95 px-2 py-1 text-xs font-medium text-foreground shadow-sm ring-1 ring-border">
          <Maximize2 className="h-3.5 w-3.5" />
          {t('zoomOpen')}
        </span>
      </button>
      {lightbox}
    </>
  );
}
