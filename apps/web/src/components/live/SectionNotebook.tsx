'use client';

import * as React from 'react';
import { useTranslations } from 'next-intl';
import { ArrowLeft, ArrowRight, Check, Lock, LockOpen } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { cn } from '@/lib/utils';

export interface NotebookSection {
  index: number;
  title: string;
}

/**
 * The lesson as a notebook: one tab per section («блок»), turned one at a
 * time. Sections past `unlocked` carry a lock — students see «Блок закрыт»
 * until the teacher opens the next one; the teacher (`host`) can look into
 * any section and gets the «Открыть блок» control.
 */
export function SectionTabs({
  sections,
  active,
  unlocked,
  onSelect,
  host,
}: {
  sections: NotebookSection[];
  active: number;
  /** How many sections are open to the class. */
  unlocked: number;
  onSelect: (index: number) => void;
  host?: {
    onSetUnlocked: (count: number) => void;
    pending: boolean;
  };
}) {
  const t = useTranslations('sections');
  const next = sections[unlocked];
  return (
    <div className="rounded-xl border bg-card p-2 shadow-sm">
      <div className="flex flex-wrap items-stretch gap-2">
        <div
          role="tablist"
          aria-label={t('title')}
          className="flex min-w-0 flex-1 gap-1.5 overflow-x-auto"
        >
          {sections.map((s) => {
            const locked = s.index >= unlocked;
            const selected = s.index === active;
            const passed = !locked && s.index < unlocked - 1;
            return (
              <button
                key={s.index}
                type="button"
                role="tab"
                aria-selected={selected}
                onClick={() => onSelect(s.index)}
                title={locked ? t('lockedTab') : s.title}
                className={cn(
                  'flex min-w-[9rem] flex-1 items-center gap-2 rounded-lg border px-3 py-2 text-left text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                  selected
                    ? 'border-primary bg-primary/10 text-foreground'
                    : locked
                      ? 'border-dashed bg-muted/40 text-muted-foreground hover:bg-muted'
                      : 'border-transparent bg-muted/60 hover:bg-accent',
                )}
              >
                <span
                  className={cn(
                    'flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold',
                    locked
                      ? 'bg-muted text-muted-foreground'
                      : selected
                        ? 'bg-primary text-primary-foreground'
                        : 'bg-success/15 text-success',
                  )}
                >
                  {locked ? (
                    <Lock className="h-3.5 w-3.5" aria-hidden />
                  ) : passed ? (
                    <Check className="h-3.5 w-3.5" aria-hidden />
                  ) : (
                    s.index + 1
                  )}
                </span>
                <span className="min-w-0">
                  <span className="block text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                    {t('blockN', { n: s.index + 1 })}
                    {locked ? ` · ${t('closed')}` : ''}
                  </span>
                  <span className="block truncate font-medium">{s.title}</span>
                </span>
              </button>
            );
          })}
        </div>
        {host ? (
          <div className="flex shrink-0 items-center gap-1.5">
            {unlocked > 1 ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={host.pending}
                onClick={() => host.onSetUnlocked(unlocked - 1)}
                title={t('lockBackHint')}
              >
                <Lock className="h-4 w-4" />
                <span className="hidden xl:inline">{t('lockBack', { n: unlocked })}</span>
              </Button>
            ) : null}
            {next ? (
              <Button
                type="button"
                disabled={host.pending}
                onClick={() => host.onSetUnlocked(unlocked + 1)}
              >
                {host.pending ? <Spinner className="h-4 w-4" /> : <LockOpen className="h-4 w-4" />}
                {t('openNext', { n: next.index + 1 })}
              </Button>
            ) : (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-success/15 px-3 py-1.5 text-xs font-semibold text-success">
                <Check className="h-3.5 w-3.5" /> {t('allOpen')}
              </span>
            )}
          </div>
        ) : null}
      </div>
    </div>
  );
}

/** What a student sees on a page the teacher has not opened yet. */
export function SectionLocked({ n, title }: { n: number; title: string }) {
  const t = useTranslations('sections');
  return (
    <div
      data-section-locked
      className="flex flex-col items-center gap-3 rounded-xl border border-dashed bg-muted/40 px-6 py-14 text-center"
    >
      <span className="flex h-14 w-14 items-center justify-center rounded-full bg-muted text-muted-foreground">
        <Lock className="h-6 w-6" aria-hidden />
      </span>
      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {t('blockN', { n })}
      </p>
      <h2 className="text-lg font-semibold">{title}</h2>
      <p className="max-w-sm text-sm text-muted-foreground">{t('lockedBody')}</p>
    </div>
  );
}

/** «Turn the page» buttons under a section. */
export function SectionPager({
  sections,
  active,
  unlocked,
  onSelect,
  host,
}: {
  sections: NotebookSection[];
  active: number;
  unlocked: number;
  onSelect: (index: number) => void;
  host?: boolean;
}) {
  const t = useTranslations('sections');
  const prev = sections[active - 1];
  const next = sections[active + 1];
  const nextLocked = !!next && next.index >= unlocked && !host;
  return (
    <div className="flex items-center justify-between gap-3 pt-2">
      {prev ? (
        <Button type="button" variant="outline" onClick={() => onSelect(prev.index)}>
          <ArrowLeft className="h-4 w-4" />
          <span className="max-w-[10rem] truncate">{prev.title}</span>
        </Button>
      ) : (
        <span />
      )}
      {next ? (
        <Button
          type="button"
          variant={nextLocked ? 'outline' : 'default'}
          disabled={nextLocked}
          onClick={() => onSelect(next.index)}
          title={nextLocked ? t('lockedBody') : undefined}
        >
          {nextLocked ? <Lock className="h-4 w-4" /> : null}
          <span className="max-w-[12rem] truncate">
            {nextLocked ? t('nextLocked') : next.title}
          </span>
          {nextLocked ? null : <ArrowRight className="h-4 w-4" />}
        </Button>
      ) : null}
    </div>
  );
}
