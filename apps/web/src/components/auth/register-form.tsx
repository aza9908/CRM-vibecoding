'use client';

import { useState, type FormEvent } from 'react';
import { useTranslations } from 'next-intl';
import { ArrowRight, Lock, Mail, User } from 'lucide-react';
import {
  registerSchema,
  userRoleEnum,
  type RegisterDto,
  type UserRole,
} from '@lms/shared';
import { useRouter, Link } from '@/i18n/routing';
import { useRegister } from '@/lib/api/hooks';
import { ApiError } from '@/lib/api/client';
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
import { AuthCard } from './auth-card';
import { FieldError } from './field-error';
import { postAuthPath } from './post-auth-redirect';

const ROLE_LABEL_KEY: Record<UserRole, string> = {
  teacher: 'roleTeacher',
  student: 'roleStudent',
  admin: 'roleAdmin',
  team_lead: 'roleTeamLead',
};

/** Controlled register form using the shared zod schema for validation. */
export function RegisterForm() {
  const t = useTranslations('auth');
  const router = useRouter();
  const register = useRegister();

  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<UserRole>('teacher');
  const [fieldErrors, setFieldErrors] = useState<
    Partial<Record<keyof RegisterDto, string>>
  >({});
  const [formError, setFormError] = useState<string | null>(null);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setFormError(null);

    const parsed = registerSchema.safeParse({
      fullName,
      email,
      password,
      role,
    });
    if (!parsed.success) {
      const errs: Partial<Record<keyof RegisterDto, string>> = {};
      for (const issue of parsed.error.issues) {
        const key = issue.path[0] as keyof RegisterDto;
        if (key === 'email') errs.email = t('validationEmail');
        else if (key === 'password') errs.password = t('validationPassword');
        else if (key === 'fullName') errs.fullName = t('validationName');
      }
      setFieldErrors(errs);
      return;
    }
    setFieldErrors({});

    try {
      const result = await register.mutateAsync(parsed.data);
      router.replace(postAuthPath(result.user.role));
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        setFormError(t('emailTaken'));
      } else {
        setFormError(err instanceof Error ? err.message : t('emailTaken'));
      }
    }
  }

  return (
    <AuthCard
      title={t('registerTitle')}
      footer={
        <span>
          {t('haveAccount')}{' '}
          <Link
            href="/login"
            className="font-medium text-primary underline-offset-4 hover:underline"
          >
            {t('toLogin')}
          </Link>
        </span>
      }
    >
      <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="fullName">{t('fullName')}</Label>
          <div className="relative">
            <User className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              id="fullName"
              autoComplete="name"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              aria-invalid={!!fieldErrors.fullName}
              className="pl-9"
            />
          </div>
          <FieldError message={fieldErrors.fullName} />
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="email">{t('email')}</Label>
          <div className="relative">
            <Mail className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              id="email"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              aria-invalid={!!fieldErrors.email}
              className="pl-9"
            />
          </div>
          <FieldError message={fieldErrors.email} />
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="password">{t('password')}</Label>
          <div className="relative">
            <Lock className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              id="password"
              type="password"
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              aria-invalid={!!fieldErrors.password}
              className="pl-9"
            />
          </div>
          <FieldError message={fieldErrors.password} />
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="role">{t('role')}</Label>
          <Select
            value={role}
            onValueChange={(v) => setRole(v as UserRole)}
          >
            <SelectTrigger id="role">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {userRoleEnum.options.map((r) => (
                <SelectItem key={r} value={r}>
                  {t(ROLE_LABEL_KEY[r])}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <FieldError message={formError} />

        <Button
          type="submit"
          disabled={register.isPending}
          className="mt-2 w-full"
        >
          {register.isPending ? <Spinner /> : null}
          {t('registerButton')}
          {!register.isPending ? <ArrowRight /> : null}
        </Button>
      </form>
    </AuthCard>
  );
}
