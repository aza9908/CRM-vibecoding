'use client';

import type { LucideIcon } from 'lucide-react';
import { useTranslations } from 'next-intl';
import {
  ExternalLink,
  Github,
  HardDrive,
  Palette,
  Send,
  StickyNote,
  Video,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { cn } from '@/lib/utils';

type ToolItem = {
  name: string;
  description: string;
  url: string;
  icon?: string;
};

/**
 * Maps the `icon` string stored per item in `tools.items` (locale data, not
 * code) to a Lucide icon. Keeping the mapping keyed by a short slug — rather
 * than storing a component reference directly in the JSON, which isn't
 * serializable — means Персонал can add a new tool with an icon by editing
 * copy, as long as the slug is one already wired up here.
 */
const ICON_BY_SLUG: Record<string, LucideIcon> = {
  video: Video,
  send: Send,
  github: Github,
  drive: HardDrive,
  palette: Palette,
  board: StickyNote,
};

/**
 * "Инструменты и платформы" — a static, i18n-driven reference list of the
 * tools/platforms used on the program (Zoom, Slack, etc.). No DB table: the
 * list lives in the `tools.items` message key per locale, exactly like any
 * other translated content, so it needs a copy change rather than a schema
 * migration when it changes.
 */
export function ToolsView() {
  const t = useTranslations('tools');
  const items = t.raw('items') as ToolItem[];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{t('title')}</h1>
        <p className="text-sm text-muted-foreground">{t('subtitle')}</p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        {items.map((item) => {
          const Icon = item.icon ? ICON_BY_SLUG[item.icon] : undefined;
          return (
            <Card key={item.name}>
              <CardHeader className="flex-row items-center gap-3 space-y-0 pb-2">
                <div
                  className={cn(
                    'flex h-9 w-9 shrink-0 items-center justify-center rounded-lg',
                    'bg-primary/10 text-primary text-sm font-semibold',
                  )}
                  aria-hidden="true"
                >
                  {Icon ? <Icon className="h-4 w-4" /> : item.name[0]}
                </div>
                <CardTitle className="text-base">{item.name}</CardTitle>
              </CardHeader>
              <CardContent className="flex items-center justify-between gap-3">
                <p className="text-sm text-muted-foreground">
                  {item.description}
                </p>
                {item.url ? (
                  <a
                    href={item.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="shrink-0 text-muted-foreground hover:text-foreground"
                    aria-label={item.name}
                  >
                    <ExternalLink className="h-4 w-4" />
                  </a>
                ) : null}
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
