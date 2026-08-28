'use client';

import { useState, type FormEvent } from 'react';
import { useTranslations } from 'next-intl';
import { ArrowRight, Briefcase, Lock, Mail, Ticket, User } from 'lucide-react';
import { registerSchema, type RegisterDto } from '@lms/shared';
import { useRouter, Link } from '@/i18n/routing';
import { useRegister } from '@/lib/api/hooks';
import { ApiError } from '@/lib/api/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Spinner } from '@/components/ui/spinner';
import { AuthCard } from './auth-card';
import { FieldError } from './field-error';
import { postAuthPath } from './post-auth-redirect';

/**
 * Controlled register form using the shared zod schema for validation.
 *
 * Per TZ_LMS_roles_promocodes.md §5.2/§12: no role picker, no "create a
 * company" option — self-registration always creates a `student` account.
 * The promo code field is optional; without one the account has no company
 * yet and lands on the "нет курсов" empty state (`CabinetView`), where the
 * same code can be entered later via `POST /auth/redeem-promo-code`.
 */
export function RegisterForm() {
  const t = useTranslations('auth');
  const router = useRouter();
  const register = useRegister();

  const [fullName, setFullName] = useState('');
  const [promoCode, setPromoCode] = useState('');
  const [occupation, setOccupation] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fieldErrors, setFieldErrors] = useState<
    Partial<Record<keyof RegisterDto, string>>
  >({});
  const [formError, setFormError] = useState<string | null>(null);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setFormError(null);

    const parsed = registerSchema.safeParse({
      fullName,
      promoCode: promoCode.trim() ? promoCode.trim() : undefined,
      occupation,
      email,
      password,
    });
    if (!parsed.success) {
      const errs: Partial<Record<keyof RegisterDto, string>> = {};
      for (const issue of parsed.error.issues) {
        const key = issue.path[0] as keyof RegisterDto;
        if (key === 'email') errs.email = t('validationEmail');
        else if (key === 'password') errs.password = t('validationPassword');
        else if (key === 'fullName') errs.fullName = t('validationName');
        else if (key === 'promoCode')
          errs.promoCode = t('validationPromoCode');
        else if (key === 'occupation')
          errs.occupation = t('validationOccupation');
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
      } else if (err instanceof ApiError && err.status === 404 && promoCode) {
        setFormError(t('invalidPromoCode'));
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
          <Label htmlFor="occupation">{t('occupation')}</Label>
          <div className="relative">
            <Briefcase className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              id="occupation"
              autoComplete="organization-title"
              value={occupation}
              onChange={(e) => setOccupation(e.target.value)}
              aria-invalid={!!fieldErrors.occupation}
              className="pl-9"
            />
          </div>
          <FieldError message={fieldErrors.occupation} />
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="promoCode">{t('promoCode')}</Label>
          <div className="relative">
            <Ticket className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              id="promoCode"
              autoComplete="off"
              value={promoCode}
              onChange={(e) => setPromoCode(e.target.value.toUpperCase())}
              aria-invalid={!!fieldErrors.promoCode}
              className="pl-9 uppercase"
            />
          </div>
          <p className="text-xs text-muted-foreground">{t('promoCodeHint')}</p>
          <FieldError message={fieldErrors.promoCode} />
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
