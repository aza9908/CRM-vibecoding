'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import {
  ExternalLink,
  FileText,
  Link2,
  Pencil,
  Plus,
  Trash2,
} from 'lucide-react';
import type { MaterialDto } from '@lms/shared';
import {
  useMaterials,
  useDeleteMaterial,
  openMaterial,
} from '@/lib/api/hooks';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Spinner } from '@/components/ui/spinner';
import { MaterialDialog } from './material-dialog';

/**
 * Teacher's standalone materials manager (`/teacher/materials`): list every
 * material in the org, create new ones (file upload or link), edit titles /
 * sources / lesson attachments, and delete.
 */
export function MaterialsManager() {
  const t = useTranslations('materials');
  const tc = useTranslations('common');
  const { data: materials, isLoading, isError, refetch } = useMaterials();
  const deleteMaterial = useDeleteMaterial();

  const [createOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState<MaterialDto | null>(null);

  function onDelete(m: MaterialDto) {
    if (!window.confirm(t('deleteConfirm'))) return;
    deleteMaterial.mutate(m.id);
  }

  return (
    <>
      <div className="mb-8 flex flex-wrap items-center justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h1 className="text-3xl font-bold tracking-tight">{t('title')}</h1>
          <p className="text-sm text-muted-foreground">{t('subtitle')}</p>
        </div>
        <Button onClick={() => setCreateOpen(true)}>
          <Plus />
          {t('newMaterial')}
        </Button>
      </div>

      {isLoading ? (
        <div className="flex items-center gap-2 text-muted-foreground">
          <Spinner />
          {tc('loading')}
        </div>
      ) : isError ? (
        <div className="flex flex-col items-start gap-3 rounded-lg border bg-card p-6 shadow-sm">
          <p className="text-destructive">{tc('error')}</p>
          <Button variant="outline" onClick={() => void refetch()}>
            {tc('retry')}
          </Button>
        </div>
      ) : !materials || materials.length === 0 ? (
        <div className="flex items-center justify-center rounded-lg border border-dashed bg-card/50 p-16 text-center">
          <p className="text-muted-foreground">{t('noMaterials')}</p>
        </div>
      ) : (
        <ul className="flex flex-col gap-2">
          {materials.map((m) => (
            <MaterialListRow
              key={m.id}
              material={m}
              onEdit={() => setEditing(m)}
              onDelete={() => onDelete(m)}
              deleting={
                deleteMaterial.isPending &&
                deleteMaterial.variables === m.id
              }
            />
          ))}
        </ul>
      )}

      <MaterialDialog open={createOpen} onClose={() => setCreateOpen(false)} />
      {editing ? (
        <MaterialDialog
          open
          onClose={() => setEditing(null)}
          material={editing}
        />
      ) : null}
    </>
  );
}

function MaterialListRow({
  material,
  onEdit,
  onDelete,
  deleting,
}: {
  material: MaterialDto;
  onEdit: () => void;
  onDelete: () => void;
  deleting: boolean;
}) {
  const t = useTranslations('materials');
  const [opening, setOpening] = useState(false);
  const isLink = material.type === 'link';
  const TypeIcon = isLink ? Link2 : FileText;

  async function open() {
    setOpening(true);
    try {
      await openMaterial(material.id);
    } catch {
      /* surfaced inline elsewhere; ignore here */
    } finally {
      setOpening(false);
    }
  }

  return (
    <li className="flex items-center gap-3 rounded-lg border bg-card px-3 py-2.5 transition-shadow hover:shadow-sm">
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
        <TypeIcon className="h-4 w-4" />
      </span>

      <button
        type="button"
        onClick={() => void open()}
        disabled={opening}
        className="flex min-w-0 flex-1 items-center gap-2 text-left disabled:opacity-60"
      >
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium text-foreground">
            {material.title}
          </span>
        </span>
        {opening ? (
          <Spinner className="h-4 w-4" />
        ) : (
          <ExternalLink className="h-4 w-4 shrink-0 text-muted-foreground" />
        )}
      </button>

      <Badge variant="secondary" className="hidden shrink-0 gap-1 sm:inline-flex">
        {isLink ? t('typeLink') : t('typeFile')}
      </Badge>

      <Button
        variant="ghost"
        size="icon"
        className="shrink-0 text-muted-foreground"
        onClick={onEdit}
        aria-label={t('editMaterial')}
      >
        <Pencil />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        className="shrink-0 text-muted-foreground hover:text-destructive"
        onClick={onDelete}
        disabled={deleting}
        aria-label={t('deleteConfirm')}
      >
        {deleting ? <Spinner className="h-4 w-4" /> : <Trash2 />}
      </Button>
    </li>
  );
}
