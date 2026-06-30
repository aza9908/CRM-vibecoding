'use client';

import {
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type FormEvent,
  type ReactNode,
} from 'react';
import { useTranslations } from 'next-intl';
import { FileUp, Link2 } from 'lucide-react';
import {
  createMaterialSchema,
  type MaterialDto,
  type MaterialType,
} from '@lms/shared';
import {
  useCreateMaterial,
  useUpdateMaterial,
  useUploadMaterialFile,
  useLessons,
} from '@/lib/api/hooks';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Spinner } from '@/components/ui/spinner';
import { FieldError } from '@/components/auth/field-error';
import { Modal } from '@/components/lessons/modal';
import { cn } from '@/lib/utils';

export interface MaterialDialogProps {
  open: boolean;
  onClose: () => void;
  /** When set, the dialog edits this material instead of creating a new one. */
  material?: MaterialDto;
  /**
   * Lessons this material is already attached to (edit mode) or that should be
   * pre-selected (create mode, e.g. from the editor panel).
   */
  attachedLessonIds?: string[];
  /**
   * When provided, the lesson multi-select is hidden and the material is always
   * attached to exactly these lessons (used by the lesson-editor panel).
   */
  fixedLessonIds?: string[];
}

/**
 * Create / edit a material. Toggle between a `file` (presign-upload) and a
 * `link` (paste a URL); pick which lessons it attaches to. On submit it calls
 * `POST /materials` or `PATCH /materials/:id` with `lessonIds`.
 */
export function MaterialDialog({
  open,
  onClose,
  material,
  attachedLessonIds,
  fixedLessonIds,
}: MaterialDialogProps) {
  const t = useTranslations('materials');
  const tc = useTranslations('common');
  const isEdit = !!material;

  const create = useCreateMaterial();
  const update = useUpdateMaterial(material?.id ?? '');
  const uploadFile = useUploadMaterialFile();
  const { data: lessons } = useLessons();

  const fileRef = useRef<HTMLInputElement>(null);

  const [title, setTitle] = useState('');
  const [type, setType] = useState<MaterialType>('link');
  // For links: the external href. For files: the uploaded S3 key.
  const [url, setUrl] = useState('');
  // A human label for the uploaded file (the key is opaque).
  const [fileLabel, setFileLabel] = useState<string | null>(null);
  const [lessonIds, setLessonIds] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  // (Re)seed the form whenever the dialog opens or the target material changes.
  useEffect(() => {
    if (!open) return;
    setError(null);
    setTitle(material?.title ?? '');
    setType(material?.type ?? 'link');
    setUrl(material?.url ?? '');
    setFileLabel(material?.type === 'file' ? material.title : null);
    setLessonIds(fixedLessonIds ?? attachedLessonIds ?? []);
  }, [open, material, attachedLessonIds, fixedLessonIds]);

  const pending = create.isPending || update.isPending;

  function toggleType(next: MaterialType) {
    if (next === type) return;
    setType(next);
    // Switching kind invalidates the previously-set url.
    setUrl('');
    setFileLabel(null);
  }

  function toggleLesson(id: string) {
    setLessonIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  }

  async function onFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setError(null);
    try {
      const { key, filename } = await uploadFile.mutateAsync(file);
      setUrl(key);
      setFileLabel(filename);
      // Default the title to the filename if the user has not typed one.
      setTitle((prev) => prev || filename);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('uploadFailed'));
    } finally {
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);

    const effectiveLessonIds = fixedLessonIds ?? lessonIds;
    const payload = {
      title: title.trim(),
      type,
      url: url.trim(),
      lessonIds: effectiveLessonIds,
    };

    const parsed = createMaterialSchema.safeParse(payload);
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? t('invalid'));
      return;
    }

    try {
      if (isEdit) {
        await update.mutateAsync(parsed.data);
      } else {
        await create.mutateAsync(parsed.data);
      }
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('saveFailed'));
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={isEdit ? t('editMaterial') : t('newMaterial')}
    >
      <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
        {/* Type toggle */}
        <div className="flex flex-col gap-1.5">
          <Label>{t('type')}</Label>
          <div className="grid grid-cols-2 gap-2">
            <TypeButton
              active={type === 'link'}
              onClick={() => toggleType('link')}
              icon={<Link2 className="h-4 w-4" />}
              label={t('typeLink')}
            />
            <TypeButton
              active={type === 'file'}
              onClick={() => toggleType('file')}
              icon={<FileUp className="h-4 w-4" />}
              label={t('typeFile')}
            />
          </div>
        </div>

        {/* Title */}
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="material-title">{t('materialTitle')}</Label>
          <Input
            id="material-title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            autoFocus
          />
        </div>

        {/* Source: link URL or file upload */}
        {type === 'link' ? (
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="material-url">{t('linkUrl')}</Label>
            <Input
              id="material-url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://…"
              inputMode="url"
            />
          </div>
        ) : (
          <div className="flex flex-col gap-1.5">
            <Label>{t('file')}</Label>
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              disabled={uploadFile.isPending}
              className="flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed bg-muted/30 px-4 py-6 text-center transition-colors hover:border-primary/50 hover:bg-accent disabled:cursor-not-allowed disabled:opacity-60"
            >
              {uploadFile.isPending ? (
                <Spinner />
              ) : (
                <FileUp className="h-5 w-5 text-muted-foreground" />
              )}
              <span className="text-sm font-medium text-foreground">
                {uploadFile.isPending
                  ? t('uploading')
                  : fileLabel ?? t('uploadFile')}
              </span>
              {!fileLabel && !uploadFile.isPending ? (
                <span className="text-xs text-muted-foreground">
                  {t('fileHint')}
                </span>
              ) : null}
            </button>
            <input
              ref={fileRef}
              type="file"
              className="hidden"
              onChange={onFile}
            />
          </div>
        )}

        {/* Lesson multi-select — hidden when lessons are fixed by the caller. */}
        {!fixedLessonIds ? (
          <div className="flex flex-col gap-1.5">
            <Label>{t('attachToLessons')}</Label>
            {!lessons || lessons.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t('noLessons')}</p>
            ) : (
              <div className="flex max-h-44 flex-col gap-1 overflow-y-auto rounded-md border p-1">
                {lessons.map((lesson) => {
                  const checked = lessonIds.includes(lesson.id);
                  return (
                    <label
                      key={lesson.id}
                      className={cn(
                        'flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors',
                        checked ? 'bg-primary/10' : 'hover:bg-accent',
                      )}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggleLesson(lesson.id)}
                        className="h-4 w-4 accent-[hsl(var(--primary))]"
                      />
                      <span className="truncate">{lesson.title}</span>
                    </label>
                  );
                })}
              </div>
            )}
          </div>
        ) : null}

        <FieldError message={error} />

        <div className="mt-2 flex justify-end gap-2 border-t pt-4">
          <Button type="button" variant="outline" onClick={onClose}>
            {tc('cancel')}
          </Button>
          <Button type="submit" disabled={pending || uploadFile.isPending}>
            {pending ? <Spinner /> : null}
            {isEdit ? tc('save') : t('createMaterial')}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function TypeButton({
  active,
  onClick,
  icon,
  label,
}: {
  active: boolean;
  onClick: () => void;
  icon: ReactNode;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        'flex items-center justify-center gap-2 rounded-md border px-3 py-2 text-sm font-medium transition-colors',
        active
          ? 'border-primary bg-primary/10 text-primary'
          : 'border-border text-muted-foreground hover:bg-accent',
      )}
    >
      {icon}
      {label}
    </button>
  );
}
