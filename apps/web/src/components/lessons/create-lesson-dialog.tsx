'use client';

import { useState, type FormEvent } from 'react';
import { useTranslations } from 'next-intl';
import {
  createLessonSchema,
  lessonKindEnum,
  lessonTypeEnum,
  type LessonKind,
  type LessonType,
} from '@lms/shared';
import { useCreateLesson } from '@/lib/api/hooks';
import { useRouter } from '@/i18n/routing';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Spinner } from '@/components/ui/spinner';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { FieldError } from '@/components/auth/field-error';
import { Modal } from './modal';

const TYPE_LABEL_KEY: Record<LessonType, string> = {
  video: 'typeVideo',
  stream: 'typeStream',
  text: 'typeText',
};

const KIND_LABEL_KEY: Record<LessonKind, string> = {
  intro: 'kindIntro',
  workshop: 'kindWorkshop',
  qa: 'kindQa',
  demo_day: 'kindDemoDay',
};

/** Sentinel value for "no kind selected" — Radix Select can't hold '' as an item value. */
const KIND_NONE = '__none__';

/** "New lesson" dialog — creates a lesson and opens its editor on success. */
export function CreateLessonDialog({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const t = useTranslations('lessons');
  const tc = useTranslations('common');
  const router = useRouter();
  const create = useCreateLesson();

  const [title, setTitle] = useState('');
  const [type, setType] = useState<LessonType>('text');
  const [kind, setKind] = useState<LessonKind | typeof KIND_NONE>(KIND_NONE);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);

    const parsed = createLessonSchema.safeParse({
      title,
      type,
      kind: kind === KIND_NONE ? undefined : kind,
    });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Invalid input');
      return;
    }

    try {
      const lesson = await create.mutateAsync(parsed.data);
      setTitle('');
      setType('text');
      setKind(KIND_NONE);
      onClose();
      router.push(`/editor/${lesson.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create lesson');
    }
  }

  return (
    <Modal open={open} onClose={onClose} title={t('newLesson')}>
      <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="lesson-title">{t('lessonTitle')}</Label>
          <Input
            id="lesson-title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            autoFocus
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="lesson-type">{t('type')}</Label>
          <Select value={type} onValueChange={(v) => setType(v as LessonType)}>
            <SelectTrigger id="lesson-type">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {lessonTypeEnum.options.map((lt) => (
                <SelectItem key={lt} value={lt}>
                  {t(TYPE_LABEL_KEY[lt])}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="lesson-kind">{t('kind')}</Label>
          <Select
            value={kind}
            onValueChange={(v) => setKind(v as LessonKind | typeof KIND_NONE)}
          >
            <SelectTrigger id="lesson-kind">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={KIND_NONE}>{t('kindNone')}</SelectItem>
              {lessonKindEnum.options.map((k) => (
                <SelectItem key={k} value={k}>
                  {t(KIND_LABEL_KEY[k])}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <FieldError message={error} />

        <div className="mt-2 flex justify-end gap-2 border-t pt-4">
          <Button type="button" variant="outline" onClick={onClose}>
            {tc('cancel')}
          </Button>
          <Button type="submit" disabled={create.isPending}>
            {create.isPending ? <Spinner /> : null}
            {t('createLesson')}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
