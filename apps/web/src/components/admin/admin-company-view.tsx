'use client';

import { useState, type FormEvent } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import {
  Ban,
  Building2,
  Check,
  Copy,
  Pencil,
  Plus,
  RotateCcw,
  Ticket,
  Trash2,
  Users,
} from 'lucide-react';
import type { PromoCodeDto } from '@lms/shared';
import {
  useCompany,
  useCreatePromoCode,
  useDeletePromoCode,
  useRenameCompany,
  useUpdatePromoCode,
} from '@/lib/api/hooks';
import { ApiError } from '@/lib/api/client';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Spinner } from '@/components/ui/spinner';
import { Modal } from '@/components/lessons/modal';

/**
 * Company settings — the company's name and the promo codes people register
 * with. Everything here is scoped to the admin's own organization by the API;
 * creating a *new* company is a platform operation (`seed:company`) and is
 * deliberately absent from this screen.
 */
export function AdminCompanyView() {
  const t = useTranslations('company');
  const tc = useTranslations('common');
  const locale = useLocale();
  const { data, isLoading, isError } = useCompany();
  const rename = useRenameCompany();
  const createCode = useCreatePromoCode();
  const updateCode = useUpdatePromoCode();
  const deleteCode = useDeletePromoCode();

  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState('');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [customCode, setCustomCode] = useState('');
  const [label, setLabel] = useState('');
  const [maxUses, setMaxUses] = useState('');
  const [expiresAt, setExpiresAt] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const dateFmt = new Intl.DateTimeFormat(locale, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });

  async function copy(code: PromoCodeDto) {
    try {
      await navigator.clipboard.writeText(code.code);
      setCopiedId(code.id);
      window.setTimeout(() => setCopiedId(null), 2000);
    } catch {
      /* clipboard unavailable — the code is still selectable by hand */
    }
  }

  function openDialog() {
    setCustomCode('');
    setLabel('');
    setMaxUses('');
    setExpiresAt('');
    setFormError(null);
    setDialogOpen(true);
  }

  async function submitCode(e: FormEvent) {
    e.preventDefault();
    setFormError(null);
    try {
      await createCode.mutateAsync({
        code: customCode.trim() ? customCode.trim().toUpperCase() : undefined,
        label: label.trim() || undefined,
        maxUses: maxUses.trim() ? Number(maxUses) : undefined,
        // <input type="date"> gives a bare day; the API wants an instant, so
        // close the code at the end of the chosen day in UTC.
        expiresAt: expiresAt
          ? new Date(`${expiresAt}T23:59:59.000Z`).toISOString()
          : undefined,
      });
      setDialogOpen(false);
    } catch (err) {
      setFormError(
        err instanceof ApiError && err.code === 'promo_code_taken'
          ? t('codeTaken')
          : t('createFailed'),
      );
    }
  }

  async function submitRename(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    await rename.mutateAsync({ name: name.trim() });
    setRenaming(false);
  }

  if (isLoading) {
    return (
      <main className="container flex items-center gap-2 py-8 text-muted-foreground">
        <Spinner />
        {tc('loading')}
      </main>
    );
  }
  if (isError || !data) {
    return (
      <main className="container py-8">
        <p className="text-destructive">{tc('error')}</p>
      </main>
    );
  }

  return (
    <main className="container flex flex-col gap-6 py-8">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">{t('title')}</h1>
        <p className="mt-1 text-muted-foreground">{t('subtitle')}</p>
      </div>

      {/* Company identity */}
      <Card>
        <CardContent className="flex flex-wrap items-center gap-4 py-6">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <Building2 className="h-6 w-6" />
          </div>
          {renaming ? (
            <form
              onSubmit={submitRename}
              className="flex min-w-0 flex-1 flex-wrap items-center gap-2"
            >
              <Input
                autoFocus
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="max-w-sm"
                aria-label={t('companyName')}
              />
              <Button type="submit" size="sm" disabled={rename.isPending}>
                {tc('save')}
              </Button>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => setRenaming(false)}
              >
                {tc('cancel')}
              </Button>
            </form>
          ) : (
            <div className="min-w-0 flex-1">
              <div className="truncate text-lg font-semibold">{data.name}</div>
              <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
                <Users className="h-4 w-4" />
                {t('memberCount', { count: data.memberCount })}
              </div>
            </div>
          )}
          {!renaming && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => {
                setName(data.name);
                setRenaming(true);
              }}
            >
              <Pencil className="h-3.5 w-3.5" />
              {tc('edit')}
            </Button>
          )}
        </CardContent>
      </Card>

      {/* Promo codes */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">{t('codesTitle')}</h2>
          <p className="text-sm text-muted-foreground">{t('codesSubtitle')}</p>
        </div>
        <Button type="button" onClick={openDialog}>
          <Plus className="h-4 w-4" />
          {t('newCode')}
        </Button>
      </div>

      {data.promoCodes.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <Ticket className="mx-auto mb-3 h-10 w-10 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">{t('noCodes')}</p>
          </CardContent>
        </Card>
      ) : (
        <Card className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b bg-muted/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-4 py-3 font-medium">{t('colCode')}</th>
                <th className="px-4 py-3 font-medium">{t('colLabel')}</th>
                <th className="px-4 py-3 font-medium">{t('colUses')}</th>
                <th className="px-4 py-3 font-medium">{t('colExpires')}</th>
                <th className="px-4 py-3 font-medium">{t('colStatus')}</th>
                <th className="px-4 py-3 font-medium">{t('colActions')}</th>
              </tr>
            </thead>
            <tbody>
              {data.promoCodes.map((c) => (
                <tr key={c.id} className="border-b last:border-0">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <span className="select-all font-mono text-base font-semibold tracking-widest">
                        {c.code}
                      </span>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        onClick={() => copy(c)}
                        aria-label={tc('copy')}
                      >
                        {copiedId === c.id ? (
                          <Check className="h-4 w-4" />
                        ) : (
                          <Copy className="h-4 w-4" />
                        )}
                      </Button>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">
                    {c.label ?? '—'}
                  </td>
                  <td className="px-4 py-3 tabular-nums">
                    {c.maxUses === null
                      ? c.usesCount
                      : `${c.usesCount} / ${c.maxUses}`}
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">
                    {c.expiresAt
                      ? dateFmt.format(new Date(c.expiresAt))
                      : t('noExpiry')}
                  </td>
                  <td className="px-4 py-3">
                    <Badge variant={c.redeemable ? 'default' : 'secondary'}>
                      {c.redeemable ? t('statusActive') : t('statusClosed')}
                    </Badge>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap gap-2">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={updateCode.isPending}
                        onClick={() =>
                          updateCode.mutate({
                            id: c.id,
                            dto: { isActive: !c.isActive },
                          })
                        }
                      >
                        {c.isActive ? (
                          <>
                            <Ban className="h-3.5 w-3.5" />
                            {t('deactivate')}
                          </>
                        ) : (
                          <>
                            <RotateCcw className="h-3.5 w-3.5" />
                            {t('activate')}
                          </>
                        )}
                      </Button>
                      {/* Used codes are the audit trail from user → intake, so
                          the API refuses to delete them; hide the button. */}
                      {c.usesCount === 0 && (
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          disabled={deleteCode.isPending}
                          onClick={() => deleteCode.mutate(c.id)}
                          aria-label={tc('delete')}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      <Modal
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        title={t('newCode')}
      >
        <form onSubmit={submitCode} className="flex flex-col gap-4">
          <p className="text-sm text-muted-foreground">{t('newCodeHint')}</p>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="customCode">{t('fieldCode')}</Label>
            <Input
              id="customCode"
              value={customCode}
              placeholder={t('fieldCodePlaceholder')}
              onChange={(e) => setCustomCode(e.target.value.toUpperCase())}
              className="font-mono tracking-widest"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="codeLabel">{t('fieldLabel')}</Label>
            <Input
              id="codeLabel"
              value={label}
              placeholder={t('fieldLabelPlaceholder')}
              onChange={(e) => setLabel(e.target.value)}
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="maxUses">{t('fieldMaxUses')}</Label>
              <Input
                id="maxUses"
                type="number"
                min={1}
                value={maxUses}
                placeholder={t('fieldMaxUsesPlaceholder')}
                onChange={(e) => setMaxUses(e.target.value)}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="expiresAt">{t('fieldExpires')}</Label>
              <Input
                id="expiresAt"
                type="date"
                value={expiresAt}
                onChange={(e) => setExpiresAt(e.target.value)}
              />
            </div>
          </div>

          {formError && <p className="text-sm text-destructive">{formError}</p>}

          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="ghost"
              onClick={() => setDialogOpen(false)}
            >
              {tc('cancel')}
            </Button>
            <Button type="submit" disabled={createCode.isPending}>
              {createCode.isPending ? <Spinner /> : null}
              {tc('create')}
            </Button>
          </div>
        </form>
      </Modal>
    </main>
  );
}
