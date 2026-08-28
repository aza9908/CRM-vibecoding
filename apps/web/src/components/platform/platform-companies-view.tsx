'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Check, Copy, Plus, RotateCw } from 'lucide-react';
import type { CompanyCodeDto } from '@lms/shared';
import {
  useCreateCompany,
  usePlatformCompanies,
  useRegenerateCompanyCode,
} from '@/lib/api/hooks';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Spinner } from '@/components/ui/spinner';
import { Modal } from '@/components/lessons/modal';

/**
 * Platform-admin screen: every company in the system, each with its current
 * promo code, so the one person who hands out codes (see `PlatformController`
 * / `PlatformAdminGuard`) never has to ask an engineer to look one up in the
 * database. A code is auto-created the moment a company registers, and
 * "Обновить код" reissues one if the old one leaked or was lost.
 */
export function PlatformCompaniesView() {
  const t = useTranslations('platform');
  const tc = useTranslations('common');
  const { data, isLoading, isError } = usePlatformCompanies();
  const regenerate = useRegenerateCompanyCode();
  const createCompany = useCreateCompany();

  const [copiedOrgId, setCopiedOrgId] = useState<string | null>(null);
  const [regeneratingOrgId, setRegeneratingOrgId] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [newName, setNewName] = useState('');
  const [newContactName, setNewContactName] = useState('');
  const [newContactEmail, setNewContactEmail] = useState('');

  async function handleCreate() {
    if (!newName.trim()) return;
    await createCompany.mutateAsync({
      name: newName.trim(),
      contactName: newContactName.trim() || undefined,
      contactEmail: newContactEmail.trim() || undefined,
    });
    setNewName('');
    setNewContactName('');
    setNewContactEmail('');
    setCreateOpen(false);
  }

  async function copyCode(company: CompanyCodeDto) {
    try {
      await navigator.clipboard.writeText(company.code.code);
      setCopiedOrgId(company.organizationId);
      setTimeout(() => setCopiedOrgId(null), 1500);
    } catch {
      /* clipboard unavailable — the code is still visible to select/copy manually */
    }
  }

  async function handleRegenerate(company: CompanyCodeDto) {
    if (!window.confirm(t('regenerateConfirm', { name: company.organizationName }))) {
      return;
    }
    setRegeneratingOrgId(company.organizationId);
    try {
      await regenerate.mutateAsync(company.organizationId);
    } finally {
      setRegeneratingOrgId(null);
    }
  }

  return (
    <main className="container flex flex-col gap-6 py-8">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{t('title')}</h1>
          <p className="mt-1 text-muted-foreground">{t('subtitle')}</p>
        </div>
        <Button type="button" onClick={() => setCreateOpen(true)}>
          <Plus className="h-4 w-4" />
          {t('addCompany')}
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
        <Card className="p-6 text-center text-muted-foreground">{t('noCompanies')}</Card>
      ) : (
        <Card className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b bg-muted/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-4 py-3 font-medium">{t('colCompany')}</th>
                <th className="px-4 py-3 font-medium">{t('colCode')}</th>
                <th className="px-4 py-3 font-medium">{t('colUses')}</th>
                <th className="px-4 py-3 font-medium">{t('colActions')}</th>
              </tr>
            </thead>
            <tbody>
              {data.map((company) => (
                <tr key={company.organizationId} className="border-b last:border-0">
                  <td className="px-4 py-3 font-medium">{company.organizationName}</td>
                  <td className="px-4 py-3 font-mono">
                    <div className="flex items-center gap-2">
                      <span className="select-all">{company.code.code}</span>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6"
                        onClick={() => copyCode(company)}
                        aria-label={t('copy')}
                      >
                        {copiedOrgId === company.organizationId ? (
                          <Check className="h-3.5 w-3.5" />
                        ) : (
                          <Copy className="h-3.5 w-3.5" />
                        )}
                      </Button>
                      {!company.code.active ? (
                        <Badge variant="outline">{t('statusRevoked')}</Badge>
                      ) : null}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">
                    {company.code.useCount}
                  </td>
                  <td className="px-4 py-3">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={regeneratingOrgId === company.organizationId}
                      onClick={() => handleRegenerate(company)}
                    >
                      {regeneratingOrgId === company.organizationId ? (
                        <Spinner />
                      ) : (
                        <RotateCw className="h-3.5 w-3.5" />
                      )}
                      {t('regenerate')}
                    </Button>
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
        title={t('addCompanyTitle')}
      >
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="companyName">{t('companyNameLabel')}</Label>
            <Input
              id="companyName"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              autoFocus
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="contactName">{t('contactNameLabel')}</Label>
            <Input
              id="contactName"
              value={newContactName}
              onChange={(e) => setNewContactName(e.target.value)}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="contactEmail">{t('contactEmailLabel')}</Label>
            <Input
              id="contactEmail"
              type="email"
              value={newContactEmail}
              onChange={(e) => setNewContactEmail(e.target.value)}
            />
          </div>
          <Button
            type="button"
            onClick={handleCreate}
            disabled={!newName.trim() || createCompany.isPending}
            className="w-full"
          >
            {createCompany.isPending ? <Spinner /> : null}
            {tc('create')}
          </Button>
        </div>
      </Modal>
    </main>
  );
}
