'use client';

import { useTranslations } from 'next-intl';
import { ExternalLink } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

type ToolItem = {
  name: string;
  description: string;
  url: string;
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
        {items.map((item) => (
          <Card key={item.name}>
            <CardHeader className="pb-2">
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
        ))}
      </div>
    </div>
  );
}
