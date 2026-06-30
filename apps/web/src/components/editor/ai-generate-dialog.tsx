'use client';

import { useState, type FormEvent } from 'react';
import { useTranslations } from 'next-intl';
import { Sparkles } from 'lucide-react';
import { generateBlocksSchema } from '@lms/shared';
import { useGenerateBlocks } from '@/lib/api/hooks';
import type { Block } from '@/lib/api/types';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Spinner } from '@/components/ui/spinner';
import { FieldError } from '@/components/auth/field-error';
import { Modal } from '@/components/lessons/modal';

/**
 * AI block generation dialog. Calls POST /lessons/:id/blocks/generate via
 * useGenerateBlocks; the returned blocks are handed back to the editor to
 * append (marked generatedBy:'ai').
 */
export function AiGenerateDialog({
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
  const generate = useGenerateBlocks(lessonId);

  const [topic, setTopic] = useState('');
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);

    const parsed = generateBlocksSchema.safeParse({ topic });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Invalid input');
      return;
    }

    try {
      const blocks = await generate.mutateAsync(parsed.data.topic);
      onGenerated(blocks);
      setTopic('');
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Generation failed');
    }
  }

  return (
    <Modal open={open} onClose={onClose} title={t('generateWithAi')}>
      <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
        <Textarea
          value={topic}
          onChange={(e) => setTopic(e.target.value)}
          placeholder={t('topicPlaceholder')}
          rows={4}
          autoFocus
        />
        <FieldError message={error} />
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose}>
            {tc('cancel')}
          </Button>
          <Button type="submit" disabled={generate.isPending}>
            {generate.isPending ? <Spinner /> : <Sparkles />}
            {t('generate')}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
