'use client';

import * as React from 'react';
import { createPortal } from 'react-dom';
import { useTranslations } from 'next-intl';
import { ChevronLeft, ChevronRight, Maximize2, Minimize2, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

/** One image in the lightbox's page-through sequence. */
export interface ZoomableImageSibling {
  src: string;
  alt?: string;
}

/**
 * Lesson image with YouTube-like fullscreen (no +/- zoom).
 * Portaled to document.body + Fullscreen API so LMS chrome cannot show through.
 *
 * `siblings`/`index`: when the caller renders a run of image blocks (e.g. a
 * PDF inserted as slides), pass every image in that run and this one's
 * position so the lightbox can page to the next/previous image without
 * closing — otherwise a multi-slide deck means opening and closing the
 * lightbox once per slide.
 */
export function ZoomableImage({
  src,
  alt,
  className,
  siblings,
  index,
}: {
  src: string;
  alt?: string;
  className?: string;
  siblings?: ZoomableImageSibling[];
  index?: number;
}) {
  const t = useTranslations('live');
  const [open, setOpen] = React.useState(false);
  const [mounted, setMounted] = React.useState(false);
  const overlayRef = React.useRef<HTMLDivElement>(null);

  const gallery = siblings && siblings.length > 1 ? siblings : null;
  const [pos, setPos] = React.useState(index ?? 0);
  const current = gallery ? (gallery[pos] ?? { src, alt }) : { src, alt };

  const goPrev = React.useCallback(() => {
    if (!gallery) return;
    setPos((p) => (p - 1 + gallery.length) % gallery.length);
  }, [gallery]);
  const goNext = React.useCallback(() => {
    if (!gallery) return;
    setPos((p) => (p + 1) % gallery.length);
  }, [gallery]);

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

  // Reset to the opened slide only on the closed->open transition, not on
  // every subsequent `index` change while the lightbox stays open — a
  // background block-list refresh (e.g. the student session poll) can shift
  // this block's index in its run, and re-snapping mid-browse would discard
  // wherever the viewer had paged to.
  const wasOpen = React.useRef(false);
  React.useEffect(() => {
    if (open && !wasOpen.current) setPos(index ?? 0);
    wasOpen.current = open;
  }, [open, index]);

  React.useEffect(() => {
    if (!open) return;
    const isEditableTarget = (target: EventTarget | null) => {
      const el = target as HTMLElement | null;
      if (!el) return false;
      const tag = el.tagName;
      return tag === 'INPUT' || tag === 'TEXTAREA' || el.isContentEditable;
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
      // Don't hijack cursor movement while the viewer is typing an answer
      // in a still-focused field behind the overlay.
      if (isEditableTarget(document.activeElement)) return;
      if (e.key === 'ArrowLeft') goPrev();
      if (e.key === 'ArrowRight') goNext();
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
  }, [open, close, goPrev, goNext]);

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
              className="absolute inset-x-0 top-0 z-10 flex items-center justify-between gap-2 bg-gradient-to-b from-black/80 to-transparent px-3 py-3"
              onClick={(e) => e.stopPropagation()}
            >
              {gallery ? (
                <span className="rounded-md bg-background/95 px-2.5 py-1 text-xs font-medium text-foreground shadow-sm ring-1 ring-border">
                  {pos + 1} / {gallery.length}
                </span>
              ) : (
                <span />
              )}
              <div className="flex items-center gap-2">
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
            </div>
            <div className="relative flex h-full w-full items-center justify-center overflow-hidden p-0">
              {gallery ? (
                <Button
                  type="button"
                  size="icon"
                  variant="secondary"
                  className="absolute left-3 top-1/2 z-10 h-11 w-11 -translate-y-1/2 bg-white text-foreground hover:bg-white/90"
                  onClick={(e) => {
                    e.stopPropagation();
                    goPrev();
                  }}
                  aria-label={t('zoomPrev')}
                  title={t('zoomPrev')}
                >
                  <ChevronLeft className="h-5 w-5" />
                </Button>
              ) : null}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={current.src}
                alt={current.alt ?? ''}
                className="h-full w-full object-contain"
                onClick={(e) => e.stopPropagation()}
                draggable={false}
              />
              {gallery ? (
                <Button
                  type="button"
                  size="icon"
                  variant="secondary"
                  className="absolute right-3 top-1/2 z-10 h-11 w-11 -translate-y-1/2 bg-white text-foreground hover:bg-white/90"
                  onClick={(e) => {
                    e.stopPropagation();
                    goNext();
                  }}
                  aria-label={t('zoomNext')}
                  title={t('zoomNext')}
                >
                  <ChevronRight className="h-5 w-5" />
                </Button>
              ) : null}
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
