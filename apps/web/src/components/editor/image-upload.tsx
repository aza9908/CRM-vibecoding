'use client';

import { useRef, useState, type ChangeEvent } from 'react';
import { useTranslations } from 'next-intl';
import { ImagePlus } from 'lucide-react';
import { useUploadImage } from '@/lib/api/hooks';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Spinner } from '@/components/ui/spinner';

/**
 * Image block editor: presign-upload a file (PUT direct to S3/R2) or paste a
 * URL. The resulting public URL is stored in the block's `imageUrl`.
 */
export function ImageUpload({
  value,
  onChange,
}: {
  value: string | null | undefined;
  onChange: (url: string | null) => void;
}) {
  const t = useTranslations('editor');
  const upload = useUploadImage();
  const inputRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);

  async function onFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setError(null);
    try {
      const publicUrl = await upload.mutateAsync(file);
      onChange(publicUrl);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      if (inputRef.current) inputRef.current.value = '';
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        disabled={upload.isPending}
        className="flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed bg-muted/30 px-4 py-8 text-center transition-colors hover:border-primary/50 hover:bg-accent disabled:cursor-not-allowed disabled:opacity-60"
      >
        {upload.isPending ? (
          <Spinner />
        ) : (
          <ImagePlus className="h-6 w-6 text-muted-foreground" />
        )}
        <span className="text-sm font-medium text-foreground">
          {upload.isPending ? t('uploading') : t('uploadImage')}
        </span>
        <span className="text-xs text-muted-foreground">SVG, PNG, JPG</span>
      </button>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={onFile}
      />

      <div className="flex flex-col gap-1.5">
        <Label className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          {t('imageUrl')}
        </Label>
        <Input
          value={value ?? ''}
          onChange={(e) => onChange(e.target.value || null)}
          placeholder="https://…"
        />
      </div>

      {value ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={value}
          alt=""
          className="max-h-48 w-fit rounded-md border object-contain"
        />
      ) : null}
      {error ? (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
