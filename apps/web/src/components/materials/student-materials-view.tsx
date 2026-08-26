'use client';

import * as React from 'react';
import { useTranslations } from 'next-intl';
import { ExternalLink, FileText, FolderOpen } from 'lucide-react';
import { openMaterial, useMaterials } from '@/lib/api/hooks/use-materials';
import {
  Card,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';

/** Read-only materials list for students. */
export function StudentMaterialsView() {
  const t = useTranslations('materials');
  const tc = useTranslations('common');
  const { data, isLoading, isError, refetch } = useMaterials();
  const [openingId, setOpeningId] = React.useState<string | null>(null);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{t('title')}</h1>
        <p className="text-sm text-muted-foreground">{t('studentHint')}</p>
      </div>

      {isLoading && (
        <div className="flex justify-center py-16">
          <Spinner />
        </div>
      )}

      {isError && (
        <Card className="p-6">
          <p className="mb-3 text-sm text-destructive">{tc('error')}</p>
          <Button type="button" variant="outline" onClick={() => void refetch()}>
            {tc('retry')}
          </Button>
        </Card>
      )}

      {!isLoading && !isError && (data?.length ?? 0) === 0 && (
        <Card className="p-8 text-center">
          <FolderOpen className="mx-auto mb-3 h-8 w-8 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">{t('noMaterials')}</p>
        </Card>
      )}

      {!isLoading && !isError && data && data.length > 0 && (
        <div className="grid gap-3">
          {data.map((m) => (
            <Card key={m.id}>
              <CardHeader className="flex flex-row items-center justify-between gap-3 space-y-0">
                <div className="flex min-w-0 items-center gap-3">
                  <FileText className="h-5 w-5 shrink-0 text-primary" />
                  <CardTitle className="truncate text-base">{m.title}</CardTitle>
                </div>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={openingId === m.id}
                  onClick={() => {
                    setOpeningId(m.id);
                    void openMaterial(m.id).finally(() => setOpeningId(null));
                  }}
                >
                  {openingId === m.id ? (
                    <Spinner className="h-4 w-4" />
                  ) : (
                    <ExternalLink className="h-4 w-4" />
                  )}
                  {t('open')}
                </Button>
              </CardHeader>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
