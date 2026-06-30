'use client';

import * as React from 'react';
import { useTranslations } from 'next-intl';
import { ExternalLink, FileText, Link2, Paperclip } from 'lucide-react';
import type { LessonMaterial } from '@lms/shared';
import { useLessonMaterials, openMaterial } from '@/lib/api/hooks';
import { Spinner } from '@/components/ui/spinner';

/**
 * Student "Materials" tab of the live workbook right panel.
 *
 * Lists the materials attached to the current lesson; a click resolves the
 * download target (presigned GET for files, raw href for links) and opens it.
 * The list is fetched with the session **participant** token, since students
 * are participants — not logged-in users.
 */
export function MaterialsTab({ lessonId }: { lessonId: string }) {
  const t = useTranslations('materials');
  const tc = useTranslations('common');
  const {
    data: materials,
    isLoading,
    isError,
    refetch,
  } = useLessonMaterials(lessonId, { participant: true });

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
        <Spinner />
        {tc('loading')}
      </div>
    );
  }

  if (isError) {
    return (
      <div className="flex flex-col items-start gap-2 py-6">
        <p className="text-sm text-destructive">{tc('error')}</p>
        <button
          type="button"
          onClick={() => void refetch()}
          className="text-sm font-medium text-primary hover:underline"
        >
          {tc('retry')}
        </button>
      </div>
    );
  }

  if (!materials || materials.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2 py-10 text-center">
        <Paperclip className="h-5 w-5 text-muted-foreground" />
        <p className="text-sm text-muted-foreground">{t('empty')}</p>
      </div>
    );
  }

  return (
    <ul className="flex flex-col gap-2">
      {materials.map((m) => (
        <MaterialRow key={m.id} material={m} participant />
      ))}
    </ul>
  );
}

/**
 * One clickable material entry. Reused by the student tab; the `participant`
 * flag selects which token the download request is authenticated with.
 */
export function MaterialRow({
  material,
  participant = false,
}: {
  material: LessonMaterial;
  participant?: boolean;
}) {
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState(false);
  const isLink = material.type === 'link';
  const TypeIcon = isLink ? Link2 : FileText;

  async function onOpen() {
    setBusy(true);
    setError(false);
    try {
      await openMaterial(material.id, { participant });
    } catch {
      setError(true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <li>
      <button
        type="button"
        onClick={() => void onOpen()}
        disabled={busy}
        className="flex w-full items-center gap-3 rounded-lg border bg-card px-3 py-2.5 text-left transition-colors hover:border-primary/50 hover:bg-accent disabled:cursor-not-allowed disabled:opacity-60"
      >
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
          {busy ? (
            <Spinner className="h-4 w-4" />
          ) : (
            <TypeIcon className="h-4 w-4" />
          )}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium text-foreground">
            {material.title}
          </span>
          {error ? (
            <span className="block text-xs text-destructive">!</span>
          ) : null}
        </span>
        <ExternalLink className="h-4 w-4 shrink-0 text-muted-foreground" />
      </button>
    </li>
  );
}
