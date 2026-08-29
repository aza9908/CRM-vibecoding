'use client';

import { useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Images, Upload } from 'lucide-react';
import {
  useCreateMaterial,
  useGenerateBlocksFromFile,
  useGenerateSlidesFromFile,
  useUploadMaterialFile,
} from '@/lib/api/hooks';
import { ApiError } from '@/lib/api/client';
import { commonApiErrorKey } from '@/lib/api-error-message';
import type { Block } from '@/lib/api/types';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { FieldError } from '@/components/auth/field-error';
import { Modal } from '@/components/lessons/modal';

const isPdf = (file: File) =>
  file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');

const ACCEPTED = '.pdf,.docx,.doc,.txt,.md,text/plain,text/markdown,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document';

/**
 * "Upload material" dialog — sibling to `AiGenerateDialog`, same callback
 * contract (`onGenerated`). Uploads the file through the existing materials
 * upload flow (`useUploadMaterialFile`), persists it as a real material
 * (`useCreateMaterial`, attached to this lesson) so the server can resolve it
 * through the same org-scoped `MaterialsService.assertMaterialInOrg` check
 * every other material read goes through, then asks the server to extract
 * its text and turn it into blocks (`useGenerateBlocksFromFile`). The editor
 * treats the result exactly like topic-based AI generation — it doesn't need
 * to know which path produced the blocks. As a side effect the source file
 * also shows up in the lesson's materials panel, which is a reasonable
 * outcome for "the material used to build this lesson."
 */
export function UploadGenerateDialog({
  lessonId,
  open,
  onClose,
  onGenerated,
}: {
  lessonId: string;
  open: boolean;
  onClose: () => void;
  onGenerated: (blocks: Block[]) => void;
}) {
  const t = useTranslations('editor');
  const tc = useTranslations('common');
  const upload = useUploadMaterialFile();
  const createMaterial = useCreateMaterial();
  const generate = useGenerateBlocksFromFile(lessonId);
  const generateSlides = useGenerateSlidesFromFile(lessonId);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const submitLockRef = useRef(false);

  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Which button was clicked — both share `upload`/`createMaterial`, so
  // their `isPending` alone can't tell the two submit flows apart while
  // the shared upload step is still running.
  const [activeMode, setActiveMode] = useState<'ai' | 'slides' | null>(null);

  const isPending =
    upload.isPending ||
    createMaterial.isPending ||
    generate.isPending ||
    generateSlides.isPending;
  const isUploading = activeMode !== null && (upload.isPending || createMaterial.isPending);

  /**
   * Maps the API's error codes to a human-readable message — showing the
   * raw code (e.g. "internal_error", "file_has_no_extractable_text") is
   * exactly the class of bug TZ_LMS_roles_promocodes.md §14.11 calls out.
   * Checks the common cases (session expiry, the shared AI-unavailable
   * code) first, then this flow's own file-specific codes; upload/
   * create-material can fail for other reasons too, so an unrecognized code
   * falls back to a neutral message instead of presumptively blaming the AI
   * step.
   */
  function friendlyError(err: unknown): string {
    const commonKey = commonApiErrorKey(err);
    if (commonKey === 'sessionExpired') return tc('sessionExpired');
    if (commonKey === 'aiGenerationUnavailable') return t('aiGenerationUnavailable');
    if (err instanceof ApiError) {
      switch (err.code) {
        case 'unsupported_file_type':
          return t('unsupportedFileType');
        case 'file_has_no_extractable_text':
          return t('fileHasNoText');
        case 'file_could_not_be_read':
          return t('fileCouldNotBeRead');
        case 'file_has_no_pages':
          return t('fileHasNoPages');
        case 'file_has_too_many_pages':
          return t('fileHasTooManyPages');
      }
    }
    return t('genericError');
  }

  async function onSubmit(mode: 'ai' | 'slides') {
    if (!file) return;
    // Synchronous re-entrancy guard: `isPending`/`activeMode` are React
    // state and don't update until the next render, so two fast clicks
    // (either button, or the same one twice) before that render would both
    // pass the `disabled` check and start a duplicate submit. A plain ref
    // is checked and set synchronously, before any await, so it can't race.
    if (submitLockRef.current) return;
    submitLockRef.current = true;
    setError(null);
    setActiveMode(mode);

    try {
      const { key, filename } = await upload.mutateAsync(file);
      const material = await createMaterial.mutateAsync({
        title: filename,
        type: 'file',
        url: key,
        lessonIds: [lessonId],
      });
      const blocks =
        mode === 'slides'
          ? await generateSlides.mutateAsync({ materialId: material.id })
          : await generate.mutateAsync({ materialId: material.id });
      onGenerated(blocks);
      setFile(null);
      onClose();
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setActiveMode(null);
      submitLockRef.current = false;
    }
  }

  return (
    <Modal open={open} onClose={onClose} title={t('uploadMaterialTitle')}>
      <div className="flex flex-col gap-4">
        <p className="text-sm text-muted-foreground">
          {t('uploadMaterialHint')}
        </p>

        <input
          ref={fileInputRef}
          type="file"
          accept={ACCEPTED}
          className="hidden"
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
        />
        <Button
          type="button"
          variant="outline"
          onClick={() => fileInputRef.current?.click()}
          disabled={isPending}
        >
          <Upload className="h-4 w-4" />
          {file ? file.name : t('chooseFile')}
        </Button>

        {file && isPdf(file) ? (
          <p className="text-xs text-muted-foreground">{t('slidesModeHint')}</p>
        ) : null}

        <FieldError message={error} />

        <div className="flex flex-wrap justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose}>
            {tc('cancel')}
          </Button>
          {file && isPdf(file) ? (
            <Button
              type="button"
              variant="outline"
              onClick={() => onSubmit('slides')}
              disabled={!file || isPending}
            >
              {activeMode === 'slides' ? <Spinner /> : <Images />}
              {activeMode === 'slides' && isUploading
                ? t('uploading')
                : generateSlides.isPending
                  ? t('generatingSlides')
                  : t('generateAsSlides')}
            </Button>
          ) : null}
          <Button
            type="button"
            onClick={() => onSubmit('ai')}
            disabled={!file || isPending}
          >
            {activeMode === 'ai' ? <Spinner /> : <Upload />}
            {activeMode === 'ai' && isUploading
              ? t('uploading')
              : generate.isPending
                ? t('generatingFromFile')
                : t('generate')}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
