'use client';

import { useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import {
  ExternalLink,
  FileText,
  Link2,
  Paperclip,
  Plus,
} from 'lucide-react';
import type { LessonMaterial, MaterialDto } from '@lms/shared';
import {
  useLessonMaterials,
  useMaterials,
  openMaterial,
} from '@/lib/api/hooks';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { MaterialDialog } from '@/components/materials/material-dialog';

/**
 * "Материалы урока" panel inside the lesson editor.
 *
 * - Lists materials already attached to this lesson (`GET /lessons/:id/materials`).
 * - "New material" opens the create dialog pinned to this lesson
 *   (`fixedLessonIds=[lessonId]`) — file upload or link.
 * - "Attach existing" opens the edit dialog for an org material with this lesson
 *   pre-selected, so the teacher confirms the full attachment set. (The API has
 *   no per-material attachment list, and PATCH lessonIds rewrites the whole set,
 *   so attachment is always confirmed via the multi-select rather than silently
 *   toggled — this avoids clobbering the material's other lessons.)
 */
export function LessonMaterialsPanel({ lessonId }: { lessonId: string }) {
  const t = useTranslations('materials');
  const tc = useTranslations('common');
  const { data: attached, isLoading } = useLessonMaterials(lessonId);
  const { data: allMaterials } = useMaterials();

  const [createOpen, setCreateOpen] = useState(false);
  const [attachPickerOpen, setAttachPickerOpen] = useState(false);
  const [attaching, setAttaching] = useState<MaterialDto | null>(null);

  const attachedIds = useMemo(
    () => new Set((attached ?? []).map((m) => m.id)),
    [attached],
  );
  // Org materials not yet attached to this lesson — candidates to attach.
  const candidates = useMemo(
    () => (allMaterials ?? []).filter((m) => !attachedIds.has(m.id)),
    [allMaterials, attachedIds],
  );

  return (
    <section className="rounded-xl border bg-card p-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-sm font-semibold">
          <Paperclip className="h-4 w-4 text-muted-foreground" />
          {t('lessonPanelTitle')}
        </h2>
        <div className="flex items-center gap-2">
          {candidates.length > 0 ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setAttachPickerOpen((v) => !v)}
            >
              {t('attachExisting')}
            </Button>
          ) : null}
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setCreateOpen(true)}
          >
            <Plus />
            {t('newMaterial')}
          </Button>
        </div>
      </div>

      {isLoading ? (
        <div className="flex items-center gap-2 py-3 text-sm text-muted-foreground">
          <Spinner />
          {tc('loading')}
        </div>
      ) : !attached || attached.length === 0 ? (
        <p className="py-3 text-sm text-muted-foreground">{t('lessonEmpty')}</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {attached.map((m) => (
            <AttachedRow key={m.id} material={m} />
          ))}
        </ul>
      )}

      {/* Inline picker of existing, not-yet-attached org materials. */}
      {attachPickerOpen && candidates.length > 0 ? (
        <div className="mt-3 flex flex-col gap-1 rounded-lg border p-1">
          <p className="px-2 py-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            {t('attachExisting')}
          </p>
          {candidates.map((m) => {
            const isLink = m.type === 'link';
            const Icon = isLink ? Link2 : FileText;
            return (
              <button
                key={m.id}
                type="button"
                onClick={() => {
                  setAttaching(m);
                  setAttachPickerOpen(false);
                }}
                className="flex items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors hover:bg-accent"
              >
                <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
                <span className="truncate">{m.title}</span>
              </button>
            );
          })}
        </div>
      ) : null}

      {/* Create new, pinned to this lesson. */}
      <MaterialDialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        fixedLessonIds={[lessonId]}
      />

      {/* Attach existing: edit dialog with this lesson pre-selected. */}
      {attaching ? (
        <MaterialDialog
          open
          onClose={() => setAttaching(null)}
          material={attaching}
          attachedLessonIds={[lessonId]}
        />
      ) : null}
    </section>
  );
}

function AttachedRow({ material }: { material: LessonMaterial }) {
  const [opening, setOpening] = useState(false);
  const isLink = material.type === 'link';
  const TypeIcon = isLink ? Link2 : FileText;

  async function open() {
    setOpening(true);
    try {
      await openMaterial(material.id);
    } catch {
      /* ignore */
    } finally {
      setOpening(false);
    }
  }

  return (
    <li>
      <button
        type="button"
        onClick={() => void open()}
        disabled={opening}
        className="flex w-full items-center gap-3 rounded-lg border bg-background px-3 py-2 text-left transition-colors hover:border-primary/50 hover:bg-accent disabled:opacity-60"
      >
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
          {opening ? (
            <Spinner className="h-4 w-4" />
          ) : (
            <TypeIcon className="h-4 w-4" />
          )}
        </span>
        <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">
          {material.title}
        </span>
        <ExternalLink className="h-4 w-4 shrink-0 text-muted-foreground" />
      </button>
    </li>
  );
}
