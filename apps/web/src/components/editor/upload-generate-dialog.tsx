'use client';

import { useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Upload } from 'lucide-react';
import {
  useCreateMaterial,
  useGenerateBlocksFromFile,
  useUploadMaterialFile,
} from '@/lib/api/hooks';
import type { Block } from '@/lib/api/types';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { FieldError } from '@/components/auth/field-error';
import { Modal } from '@/components/lessons/modal';

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
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);

  const isPending =
    upload.isPending || createMaterial.isPending || generate.isPending;

  async function onSubmit() {
    if (!file) return;
    setError(null);

    try {
      const { key, filename } = await upload.mutateAsync(file);
      const material = await createMaterial.mutateAsync({
        title: filename,
        type: 'file',
        url: key,
        lessonIds: [lessonId],
      });
      const blocks = await generate.mutateAsync({ materialId: material.id });
      onGenerated(blocks);
      setFile(null);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Generation failed');
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

        <FieldError message={error} />

        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose}>
            {tc('cancel')}
          </Button>
          <Button type="button" onClick={onSubmit} disabled={!file || isPending}>
            {isPending ? <Spinner /> : <Upload />}
            {upload.isPending
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
