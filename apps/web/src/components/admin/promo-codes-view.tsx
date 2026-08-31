'use client';

import { useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Check, Copy, Plus, Trash2 } from 'lucide-react';
import type { PromoCodeDto } from '@lms/shared';
import {
  usePromoCodes,
  useCreatePromoCode,
  useRevokePromoCode,
  useDeletePromoCode,
} from '@/lib/api/hooks';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Spinner } from '@/components/ui/spinner';
import { Modal } from '@/components/lessons/modal';

function formatDate(iso: string | null, locale: string): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString(locale);
}

/** Admin panel — create/list/revoke company promo codes (docs extension). A
 * new user who enters an active code at registration joins this org instead
 * of creating a new one; see `AuthService.register`. */
export function PromoCodesView() {
  const t = useTranslations('admin');
  const tc = useTranslations('common');
  const locale = useLocale();
  const { data, isLoading, isError } = usePromoCodes();
  const createCode = useCreatePromoCode();
  const revokeCode = useRevokePromoCode();
  const deleteCode = useDeletePromoCode();

  const [createOpen, setCreateOpen] = useState(false);
  const [maxUses, setMaxUses] = useState('');
  const [expiresAt, setExpiresAt] = useState('');
  const [copiedId, setCopiedId] = useState<string | null>(null);

  async function handleCreate() {
    await createCode.mutateAsync({
      maxUses: maxUses ? Number(maxUses) : undefined,
      expiresAt: expiresAt ? new Date(expiresAt).toISOString() : undefined,
    });
    setMaxUses('');
    setExpiresAt('');
    setCreateOpen(false);
  }

  async function copyCode(c: PromoCodeDto) {
    try {
      await navigator.clipboard.writeText(c.code);
      setCopiedId(c.id);
      setTimeout(() => setCopiedId(null), 1500);
    } catch {
      /* clipboard unavailable — the code is still visible to select/copy manually */
    }
  }

  return (
    <main className="container flex flex-col gap-6 py-8">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">
            {t('promoCodesTitle')}
          </h1>
          <p className="mt-1 text-muted-foreground">
            {t('promoCodesSubtitle')}
          </p>
        </div>
        <Button type="button" onClick={() => setCreateOpen(true)}>
          <Plus className="h-4 w-4" />
          {t('createCode')}
        </Button>
      </div>

      {isLoading ? (
        <div className="flex items-center gap-2 text-muted-foreground">
          <Spinner />
          {tc('loading')}
        </div>
      ) : isError ? (
        <p className="text-destructive">{tc('error')}</p>
      ) : !data?.length ? (
        <Card className="p-6 text-center text-muted-foreground">
          {t('noCodes')}
        </Card>
      ) : (
        <Card className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b bg-muted/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-4 py-3 font-medium">{t('colCode')}</th>
                <th className="px-4 py-3 font-medium">{t('colUses')}</th>
                <th className="px-4 py-3 font-medium">{t('colExpires')}</th>
                <th className="px-4 py-3 font-medium">{t('colStatus')}</th>
                <th className="px-4 py-3 font-medium">{t('colActions')}</th>
              </tr>
            </thead>
            <tbody>
              {data.map((c) => (
                <tr key={c.id} className="border-b last:border-0">
                  <td className="px-4 py-3 font-mono font-medium">
                    <div className="flex items-center gap-2">
                      <span className="select-all">{c.code}</span>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6"
                        onClick={() => copyCode(c)}
                        aria-label={t('copy')}
                      >
                        {copiedId === c.id ? (
                          <Check className="h-3.5 w-3.5" />
                        ) : (
                          <Copy className="h-3.5 w-3.5" />
                        )}
                      </Button>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">
                    {c.useCount}
                    {c.maxUses != null ? ` / ${c.maxUses}` : ` (${t('unlimited')})`}
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">
                    {c.expiresAt ? formatDate(c.expiresAt, locale) : t('never')}
                  </td>
                  <td className="px-4 py-3">
                    <Badge variant={c.active ? 'default' : 'outline'}>
                      {c.active ? t('statusActive') : t('statusRevoked')}
                    </Badge>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1.5">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={!c.active || revokeCode.isPending}
                        onClick={() => revokeCode.mutate(c.id)}
                      >
                        {t('revoke')}
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-muted-foreground hover:text-destructive"
                        disabled={deleteCode.isPending}
                        onClick={() => {
                          if (!window.confirm(t('deleteCodeConfirm'))) return;
                          deleteCode.mutate(c.id);
                        }}
                        aria-label={t('deleteCode')}
                        title={t('deleteCode')}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      <Modal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        title={t('createDialogTitle')}
      >
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="maxUses">{t('maxUsesLabel')}</Label>
            <Input
              id="maxUses"
              type="number"
              min={1}
              value={maxUses}
              onChange={(e) => setMaxUses(e.target.value)}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="expiresAt">{t('expiresAtLabel')}</Label>
            <Input
              id="expiresAt"
              type="date"
              value={expiresAt}
              onChange={(e) => setExpiresAt(e.target.value)}
            />
          </div>
          <Button
            type="button"
            onClick={handleCreate}
            disabled={createCode.isPending}
            className="w-full"
          >
            {createCode.isPending ? <Spinner /> : null}
            {tc('create')}
          </Button>
        </div>
      </Modal>
    </main>
  );
}
