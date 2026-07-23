'use client';

import { useState, type FormEvent } from 'react';
import { useTranslations } from 'next-intl';
import { ArrowRight, CheckCircle2, Mail } from 'lucide-react';
import { forgotPasswordSchema } from '@lms/shared';
import { Link } from '@/i18n/routing';
import { useForgotPassword } from '@/lib/api/hooks';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Spinner } from '@/components/ui/spinner';
import { AuthCard } from './auth-card';
import { FieldError } from './field-error';

/**
 * Step 1 of password recovery: ask for the address.
 *
 * On submit we show the same confirmation screen whatever the server says,
 * because the endpoint intentionally cannot tell us whether the account exists.
 * Surfacing a "no such user" error here would undo that protection.
 */
export function ForgotPasswordForm() {
  const t = useTranslations('auth');
  const forgot = useForgotPassword();

  const [email, setEmail] = useState('');
  const [emailError, setEmailError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setEmailError(null);

    const parsed = forgotPasswordSchema.safeParse({ email });
    if (!parsed.success) {
      setEmailError(t('validationEmail'));
      return;
    }

    try {
      await forgot.mutateAsync(parsed.data);
    } catch {
      // Swallowed on purpose — see the note above. A transport failure still
      // lands on the confirmation screen; the user can retry from there.
    }
    setSent(true);
  }

  if (sent) {
    return (
      <AuthCard
        title={t('forgotSentTitle')}
        footer={
          <span>
            <Link
              href="/login"
              className="font-medium text-primary underline-offset-4 hover:underline"
            >
              {t('backToLogin')}
            </Link>
          </span>
        }
      >
        <div className="flex flex-col items-center gap-4 py-4 text-center">
          <CheckCircle2 className="h-12 w-12 text-primary" aria-hidden />
          <p className="text-sm leading-relaxed text-muted-foreground">
            {t('forgotSentBody', { email })}
          </p>
          <button
            type="button"
            onClick={() => setSent(false)}
            className="text-sm font-medium text-primary underline-offset-4 hover:underline"
          >
            {t('forgotResend')}
          </button>
        </div>
      </AuthCard>
    );
  }

  return (
    <AuthCard
      title={t('forgotTitle')}
      description={t('forgotDescription')}
      footer={
        <span>
          <Link
            href="/login"
            className="font-medium text-primary underline-offset-4 hover:underline"
          >
            {t('backToLogin')}
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
              autoFocus
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              aria-invalid={!!emailError}
              className="pl-9"
            />
          </div>
          <FieldError message={emailError ?? undefined} />
        </div>

        <Button
          type="submit"
          disabled={forgot.isPending}
          className="mt-2 w-full"
        >
          {forgot.isPending ? <Spinner /> : null}
          {t('forgotButton')}
          {!forgot.isPending ? <ArrowRight /> : null}
        </Button>
      </form>
    </AuthCard>
  );
}
