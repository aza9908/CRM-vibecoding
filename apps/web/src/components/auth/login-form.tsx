'use client';

import { useState, type FormEvent } from 'react';
import { useTranslations } from 'next-intl';
import { ArrowRight, Lock, Mail } from 'lucide-react';
import { loginSchema, type LoginDto } from '@lms/shared';
import { useRouter, Link } from '@/i18n/routing';
import { useLogin } from '@/lib/api/hooks';
import { ApiError } from '@/lib/api/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Spinner } from '@/components/ui/spinner';
import { AuthCard } from './auth-card';
import { FieldError } from './field-error';
import { postAuthPath } from './post-auth-redirect';

/** Controlled login form using the shared zod schema for validation. */
export function LoginForm() {
  const t = useTranslations('auth');
  const router = useRouter();
  const login = useLogin();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fieldErrors, setFieldErrors] = useState<
    Partial<Record<keyof LoginDto, string>>
  >({});
  const [formError, setFormError] = useState<string | null>(null);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setFormError(null);

    const parsed = loginSchema.safeParse({ email, password });
    if (!parsed.success) {
      const errs: Partial<Record<keyof LoginDto, string>> = {};
      for (const issue of parsed.error.issues) {
        const key = issue.path[0] as keyof LoginDto;
        if (key === 'email') errs.email = t('validationEmail');
        else if (key === 'password') errs.password = t('validationPassword');
      }
      setFieldErrors(errs);
      return;
    }
    setFieldErrors({});

    try {
      const result = await login.mutateAsync(parsed.data);
      router.replace(postAuthPath(result.user.role));
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        setFormError(t('invalidCredentials'));
      } else {
        setFormError(
          err instanceof Error ? err.message : t('invalidCredentials'),
        );
      }
    }
  }

  return (
    <AuthCard
      title={t('loginTitle')}
      footer={
        <span>
          {t('noAccount')}{' '}
          <Link
            href="/register"
            className="font-medium text-primary underline-offset-4 hover:underline"
          >
            {t('toRegister')}
          </Link>
        </span>
      }
    >
      <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
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
          <div className="flex items-baseline justify-between gap-2">
            <Label htmlFor="password">{t('password')}</Label>
            <Link
              href="/forgot-password"
              className="text-xs font-medium text-muted-foreground underline-offset-4 transition-colors hover:text-primary hover:underline"
            >
              {t('forgotLink')}
            </Link>
          </div>
          <div className="relative">
            <Lock className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              id="password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              aria-invalid={!!fieldErrors.password}
              className="pl-9"
            />
          </div>
          <FieldError message={fieldErrors.password} />
        </div>

        <FieldError message={formError} />

        <Button
          type="submit"
          disabled={login.isPending}
          className="mt-2 w-full"
        >
          {login.isPending ? <Spinner /> : null}
          {t('loginButton')}
          {!login.isPending ? <ArrowRight /> : null}
        </Button>
      </form>
    </AuthCard>
  );
}
