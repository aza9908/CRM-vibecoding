'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Check, Copy, KeyRound } from 'lucide-react';
import { userRoleEnum, type AdminUserDto, type UserRole } from '@lms/shared';
import { useAuthStore } from '@/lib/store/auth-store';
import {
  useAdminUsers,
  useChangeUserRole,
  useResetPassword,
} from '@/lib/api/hooks';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Modal } from '@/components/lessons/modal';

const ROLE_LABEL_KEY: Record<UserRole, string> = {
  teacher: 'roleTeacher',
  student: 'roleStudent',
  admin: 'roleAdmin',
  team_lead: 'roleTeamLead',
};

/** Admin panel — org user list, role changes, password resets. Mirrors the
 * self-registration guard: an admin can't change their own role here either. */
export function AdminUsersView() {
  const t = useTranslations('admin');
  const ta = useTranslations('auth');
  const tc = useTranslations('common');
  const currentUserId = useAuthStore((s) => s.user?.id);
  const { data, isLoading, isError } = useAdminUsers();
  const changeRole = useChangeUserRole();
  const resetPassword = useResetPassword();

  const [resetTarget, setResetTarget] = useState<AdminUserDto | null>(null);
  const [tempPassword, setTempPassword] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  async function handleReset(u: AdminUserDto) {
    setResetTarget(u);
    setTempPassword(null);
    setCopied(false);
    const result = await resetPassword.mutateAsync(u.id);
    setTempPassword(result.temporaryPassword);
  }

  async function copyPassword() {
    if (!tempPassword) return;
    try {
      await navigator.clipboard.writeText(tempPassword);
      setCopied(true);
    } catch {
      /* clipboard unavailable — the password is still visible to select/copy manually */
    }
  }

  return (
    <main className="container flex flex-col gap-6 py-8">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">{t('title')}</h1>
        <p className="mt-1 text-muted-foreground">{t('subtitle')}</p>
      </div>

      {isLoading ? (
        <div className="flex items-center gap-2 text-muted-foreground">
          <Spinner />
          {tc('loading')}
        </div>
      ) : isError ? (
        <p className="text-destructive">{tc('error')}</p>
      ) : (
        <Card className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b bg-muted/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-4 py-3 font-medium">{t('colName')}</th>
                <th className="px-4 py-3 font-medium">{t('colEmail')}</th>
                <th className="px-4 py-3 font-medium">{t('colRole')}</th>
                <th className="px-4 py-3 font-medium">{t('colActions')}</th>
              </tr>
            </thead>
            <tbody>
              {(data ?? []).map((u) => {
                const isSelf = u.id === currentUserId;
                return (
                  <tr key={u.id} className="border-b last:border-0">
                    <td className="px-4 py-3 font-medium">
                      {u.fullName ?? '—'}
                      {isSelf ? (
                        <Badge variant="outline" className="ml-2">
                          {tc('you')}
                        </Badge>
                      ) : null}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {u.email}
                    </td>
                    <td className="px-4 py-3">
                      <Select
                        value={u.role}
                        disabled={isSelf || changeRole.isPending}
                        onValueChange={(role) =>
                          changeRole.mutate({
                            id: u.id,
                            dto: { role: role as UserRole },
                          })
                        }
                      >
                        <SelectTrigger className="h-8 w-40">
                          <SelectValue>{ta(ROLE_LABEL_KEY[u.role])}</SelectValue>
                        </SelectTrigger>
                        <SelectContent>
                          {userRoleEnum.options.map((r) => (
                            <SelectItem key={r} value={r}>
                              {ta(ROLE_LABEL_KEY[r])}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </td>
                    <td className="px-4 py-3">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={isSelf || resetPassword.isPending}
                        onClick={() => handleReset(u)}
                      >
                        <KeyRound className="h-3.5 w-3.5" />
                        {t('resetPassword')}
                      </Button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Card>
      )}

      <Modal
        open={!!resetTarget}
        onClose={() => setResetTarget(null)}
        title={t('resetPasswordTitle')}
      >
        {resetTarget ? (
          <div className="flex flex-col gap-3">
            <p className="text-sm text-muted-foreground">
              {resetTarget.email}
            </p>
            {tempPassword ? (
              <>
                <div className="flex items-center gap-2 rounded-md border bg-muted/40 px-3 py-2 font-mono text-base">
                  <span className="flex-1 select-all">{tempPassword}</span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    onClick={copyPassword}
                    aria-label={t('copy')}
                  >
                    {copied ? (
                      <Check className="h-4 w-4" />
                    ) : (
                      <Copy className="h-4 w-4" />
                    )}
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">
                  {t('resetPasswordHint')}
                </p>
              </>
            ) : (
              <div className="flex items-center gap-2 text-muted-foreground">
                <Spinner />
                {tc('loading')}
              </div>
            )}
            <Button
              type="button"
              variant="secondary"
              onClick={() => setResetTarget(null)}
            >
              {t('close')}
            </Button>
          </div>
        ) : null}
      </Modal>
    </main>
  );
}
