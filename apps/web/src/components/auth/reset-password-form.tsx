'use client';

import { useMemo, useState, type FormEvent } from 'react';
import { useTranslations } from 'next-intl';
import { useSearchParams } from 'next/navigation';
import { AlertCircle, ArrowRight, CheckCircle2, Lock } from 'lucide-react';
import { resetPasswordSchema, type ResetPasswordDto } from '@lms/shared';
import { Link, useRouter } from '@/i18n/routing';
import { useResetPassword, useValidateResetToken } from '@/lib/api/hooks';
import { ApiError } from '@/lib/api/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Spinner } from '@/components/ui/spinner';
import { AuthCard } from './auth-card';
import { FieldError } from './field-error';

/** Cheap client-side strength hint. Not a gate — the server enforces min 8. */
function scorePassword(pw: string): 0 | 1 | 2 | 3 {
  if (pw.length < 8) return 0;
  let score = 0;
  if (pw.length >= 12) score++;
  if (/[a-z]/.test(pw) && /[A-Z]/.test(pw)) score++;
  if (/\d/.test(pw) && /[^\w\s]/.test(pw)) score++;
  return Math.min(score, 3) as 0 | 1 | 2 | 3;
}

/**
 * Step 2 of password recovery.
 *
 * The token arrives in the query string. We validate it before rendering the
 * form so a stale link produces a clear message instead of letting someone type
 * a new password only to be rejected on submit.
 */
export function ResetPasswordForm() {
  const t = useTranslations('auth');
  const router = useRouter();
  const params = useSearchParams();
  const token = params.get('token');

  const check = useValidateResetToken(token);
  const reset = useResetPassword();

  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [fieldErrors, setFieldErrors] = useState<
    Partial<Record<keyof ResetPasswordDto, string>>
  >({});
  const [formError, setFormError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const strength = useMemo(() => scorePassword(password), [password]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setFormError(null);

    const parsed = resetPasswordSchema.safeParse({
      token: token ?? '',
      password,
      confirmPassword,
    });

    if (!parsed.success) {
      const errs: Partial<Record<keyof ResetPasswordDto, string>> = {};
      for (const issue of parsed.error.issues) {
        const key = issue.path[0] as keyof ResetPasswordDto;
        if (key === 'password') errs.password = t('validationPassword');
        else if (key === 'confirmPassword') {
          errs.confirmPassword =
            issue.message === 'passwords_do_not_match'
              ? t('passwordsDoNotMatch')
              : t('validationPassword');
        }
      }
      setFieldErrors(errs);
      return;
    }
    setFieldErrors({});

    try {
      await reset.mutateAsync(parsed.data);
      setDone(true);
      setTimeout(() => router.replace('/login'), 2500);
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.code === 'password_unchanged') {
          setFormError(t('passwordUnchanged'));
          return;
        }
        if (err.status === 400) {
          setFormError(t('resetLinkInvalid'));
          return;
        }
      }
      setFormError(err instanceof Error ? err.message : t('resetFailed'));
    }
  }

  /* --- missing / invalid / expired link --------------------------------- */
  const linkBroken = !token || (check.isFetched && !check.data?.valid);

  if (linkBroken) {
    return (
      <AuthCard title={t('resetInvalidTitle')}>
        <div className="flex flex-col items-center gap-4 py-4 text-center">
          <AlertCircle className="h-12 w-12 text-destructive" aria-hidden />
          <p className="text-sm leading-relaxed text-muted-foreground">
            {t('resetInvalidBody')}
          </p>
          <Button
            type="button"
            className="w-full"
            onClick={() => router.push('/forgot-password')}
          >
            {t('resetRequestNew')}
          </Button>
          <Link
            href="/login"
            className="text-sm font-medium text-primary underline-offset-4 hover:underline"
          >
            {t('backToLogin')}
          </Link>
        </div>
      </AuthCard>
    );
  }

  /* --- still checking ---------------------------------------------------- */
  if (check.isLoading) {
    return (
      <AuthCard title={t('resetTitle')}>
        <div className="flex items-center justify-center gap-3 py-10 text-muted-foreground">
          <Spinner />
          <span className="text-sm">{t('resetChecking')}</span>
        </div>
      </AuthCard>
    );
  }

  /* --- success ----------------------------------------------------------- */
  if (done) {
    return (
      <AuthCard title={t('resetDoneTitle')}>
        <div className="flex flex-col items-center gap-4 py-4 text-center">
          <CheckCircle2 className="h-12 w-12 text-primary" aria-hidden />
          <p className="text-sm leading-relaxed text-muted-foreground">
            {t('resetDoneBody')}
          </p>
          <Link
            href="/login"
            className="text-sm font-medium text-primary underline-offset-4 hover:underline"
          >
            {t('backToLogin')}
          </Link>
        </div>
      </AuthCard>
    );
  }

  /* --- the form ---------------------------------------------------------- */
  return (
    <AuthCard title={t('resetTitle')} description={t('resetDescription')}>
      <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="password">{t('newPassword')}</Label>
          <div className="relative">
            <Lock className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              id="password"
              type="password"
              autoComplete="new-password"
              autoFocus
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              aria-invalid={!!fieldErrors.password}
              className="pl-9"
            />
          </div>

          {password ? (
            <div className="mt-1 flex items-center gap-2">
              <div
                className="flex h-1 flex-1 gap-1"
                role="presentation"
                aria-hidden
              >
                {[1, 2, 3].map((i) => (
                  <span
                    key={i}
                    className={
                      'h-full flex-1 rounded-full transition-colors ' +
                      (strength >= i ? 'bg-primary' : 'bg-muted')
                    }
                  />
                ))}
              </div>
              <span className="text-xs text-muted-foreground">
                {t(
                  strength === 0
                    ? 'strengthWeak'
                    : strength === 1
                      ? 'strengthFair'
                      : strength === 2
                        ? 'strengthGood'
                        : 'strengthStrong',
                )}
              </span>
            </div>
          ) : null}

          <FieldError message={fieldErrors.password} />
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="confirmPassword">{t('confirmPassword')}</Label>
          <div className="relative">
            <Lock className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              id="confirmPassword"
              type="password"
              autoComplete="new-password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              aria-invalid={!!fieldErrors.confirmPassword}
              className="pl-9"
            />
          </div>
          <FieldError message={fieldErrors.confirmPassword} />
        </div>

        <FieldError message={formError ?? undefined} />

        <Button
          type="submit"
          disabled={reset.isPending}
          className="mt-2 w-full"
        >
          {reset.isPending ? <Spinner /> : null}
          {t('resetButton')}
          {!reset.isPending ? <ArrowRight /> : null}
        </Button>
      </form>
    </AuthCard>
  );
}
