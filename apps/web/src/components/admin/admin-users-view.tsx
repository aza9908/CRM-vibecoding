'use client';

import { useState, type FormEvent } from 'react';
import { useTranslations } from 'next-intl';
import { Check, Copy, KeyRound, Plus, UserPlus } from 'lucide-react';
import {
  createUserRoleEnum,
  userRoleEnum,
  type AdminUserDto,
  type CreateUserResult,
  type UserRole,
} from '@lms/shared';
import { useAuthStore } from '@/lib/store/auth-store';
import {
  useAdminUsers,
  useChangeUserRole,
  useAdminResetPassword,
  useCreateUser,
} from '@/lib/api/hooks';
import { ApiError } from '@/lib/api/client';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
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
import { Modal } from '@/components/lessons/modal';

const ROLE_LABEL_KEY: Record<UserRole, string> = {
  teacher: 'roleTeacher',
  student: 'roleStudent',
  admin: 'roleAdmin',
  team_lead: 'roleTeamLead',
  methodist: 'roleMethodist',
};

/** A shared "here's the one-time password, copy it now" panel — used for
 * both password resets and freshly created accounts. */
function TemporaryPasswordPanel({
  password,
  hint,
}: {
  password: string;
  hint: string;
}) {
  const t = useTranslations('admin');
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(password);
      setCopied(true);
    } catch {
      /* clipboard unavailable — the password is still visible to select/copy manually */
    }
  }

  return (
    <>
      <div className="flex items-center gap-2 rounded-md border bg-muted/40 px-3 py-2 font-mono text-base">
        <span className="flex-1 select-all">{password}</span>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={copy}
          aria-label={t('copy')}
        >
          {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">{hint}</p>
    </>
  );
}

/**
 * Admin panel — org user list, role changes, password resets, and creating
 * new accounts directly (admin-only; see `POST /admin/users`). Mirrors the
 * self-registration guard: an admin can't change their own role here either.
 */
export function AdminUsersView() {
  const t = useTranslations('admin');
  const ta = useTranslations('auth');
  const tc = useTranslations('common');
  const currentUserId = useAuthStore((s) => s.user?.id);
  const { data, isLoading, isError } = useAdminUsers();
  const changeRole = useChangeUserRole();
  const resetPassword = useAdminResetPassword();
  const createUser = useCreateUser();

  const [resetTarget, setResetTarget] = useState<AdminUserDto | null>(null);
  const [tempPassword, setTempPassword] = useState<string | null>(null);

  const [createOpen, setCreateOpen] = useState(false);
  const [newEmail, setNewEmail] = useState('');
  const [newFullName, setNewFullName] = useState('');
  const [newRole, setNewRole] = useState<(typeof createUserRoleEnum.options)[number]>(
    'student',
  );
  const [created, setCreated] = useState<CreateUserResult | null>(null);
  const [createError, setCreateError] = useState<string | null>(null);

  async function handleReset(u: AdminUserDto) {
    setResetTarget(u);
    setTempPassword(null);
    const result = await resetPassword.mutateAsync(u.id);
    setTempPassword(result.temporaryPassword);
  }

  async function handleCreate(e: FormEvent) {
    e.preventDefault();
    if (!newEmail.trim() || !newFullName.trim()) return;
    setCreateError(null);
    try {
      const result = await createUser.mutateAsync({
        email: newEmail.trim(),
        fullName: newFullName.trim(),
        role: newRole,
      });
      setCreated(result);
      setNewEmail('');
      setNewFullName('');
      setNewRole('student');
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        setCreateError(t('createUserErrorTaken'));
      } else {
        setCreateError(t('createUserError'));
      }
    }
  }

  function closeCreateDialog() {
    // Closing while the request is in flight would lose the one-time
    // temporary password the instant it comes back — the submit button is
    // the only way out until the mutation settles.
    if (createUser.isPending) return;
    setCreateOpen(false);
    setCreated(null);
    setCreateError(null);
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{t('title')}</h1>
          <p className="mt-1 text-muted-foreground">{t('subtitle')}</p>
        </div>
        <Button type="button" onClick={() => setCreateOpen(true)}>
          <UserPlus className="h-4 w-4" />
          {t('createUser')}
        </Button>
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
              <TemporaryPasswordPanel
                password={tempPassword}
                hint={t('resetPasswordHint')}
              />
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

      <Modal
        open={createOpen}
        onClose={closeCreateDialog}
        title={t('createUserTitle')}
      >
        {created ? (
          <div className="flex flex-col gap-3">
            <p className="text-sm text-muted-foreground">{created.email}</p>
            <TemporaryPasswordPanel
              password={created.temporaryPassword}
              hint={t('resetPasswordHint')}
            />
            <Button type="button" variant="secondary" onClick={closeCreateDialog}>
              {t('close')}
            </Button>
          </div>
        ) : (
          <form onSubmit={handleCreate} className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="newUserFullName">{t('colName')}</Label>
              <Input
                id="newUserFullName"
                value={newFullName}
                onChange={(e) => setNewFullName(e.target.value)}
                required
                autoFocus
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="newUserEmail">{t('colEmail')}</Label>
              <Input
                id="newUserEmail"
                type="email"
                value={newEmail}
                onChange={(e) => setNewEmail(e.target.value)}
                required
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="newUserRole">{t('colRole')}</Label>
              <Select
                value={newRole}
                onValueChange={(v) =>
                  setNewRole(v as (typeof createUserRoleEnum.options)[number])
                }
              >
                <SelectTrigger id="newUserRole">
                  <SelectValue>{ta(ROLE_LABEL_KEY[newRole])}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {createUserRoleEnum.options.map((r) => (
                    <SelectItem key={r} value={r}>
                      {ta(ROLE_LABEL_KEY[r])}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {createError ? (
              <p className="text-sm text-destructive">{createError}</p>
            ) : null}
            <Button
              type="submit"
              disabled={
                !newEmail.trim() || !newFullName.trim() || createUser.isPending
              }
              className="w-full"
            >
              {createUser.isPending ? <Spinner /> : <Plus className="h-4 w-4" />}
              {t('createUser')}
            </Button>
          </form>
        )}
      </Modal>
    </div>
  );
}
