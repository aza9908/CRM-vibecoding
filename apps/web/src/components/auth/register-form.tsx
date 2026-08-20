'use client';

import { useState, type FormEvent } from 'react';
import { useTranslations } from 'next-intl';
import {
  ArrowRight,
  Briefcase,
  Building2,
  Check,
  Lock,
  Mail,
  Ticket,
  User,
} from 'lucide-react';
import {
  registerSchema,
  selfRegisterRoleEnum,
  type RegisterDto,
  type UserRole,
} from '@lms/shared';
import { useRouter, Link } from '@/i18n/routing';
import { usePromoCodeLookup, useRegister } from '@/lib/api/hooks';
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
  curator: 'roleCurator',
  methodist: 'roleMethodist',
};

/**
 * Server rejection codes for a promo code, mapped to their message key. The
 * API distinguishes them so a registrant can tell "I mistyped it" from "my
 * company's intake is closed" without contacting support.
 */
const PROMO_ERROR_KEY: Record<string, string> = {
  promo_code_not_found: 'promoCodeUnknown',
  promo_code_inactive: 'promoCodeInactive',
  promo_code_expired: 'promoCodeExpired',
  promo_code_exhausted: 'promoCodeExhausted',
};

/** Controlled register form using the shared zod schema for validation. */
export function RegisterForm() {
  const t = useTranslations('auth');
  const router = useRouter();
  const register = useRegister();

  const [fullName, setFullName] = useState('');
  const [promoCode, setPromoCode] = useState('');
  const [occupation, setOccupation] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<UserRole>('student');
  const [fieldErrors, setFieldErrors] = useState<
    Partial<Record<keyof RegisterDto, string>>
  >({});
  const [formError, setFormError] = useState<string | null>(null);

  // Confirms which company the code belongs to before the account is created,
  // so a typo is caught here rather than after landing in the wrong tenant.
  const lookup = usePromoCodeLookup(promoCode);
  const resolvedCompany = lookup.data?.valid ? lookup.data.companyName : null;

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setFormError(null);

    const parsed = registerSchema.safeParse({
      fullName,
      promoCode,
      occupation,
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
        else if (key === 'promoCode') errs.promoCode = t('validationPromoCode');
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
      if (err instanceof ApiError) {
        const promoKey = err.code ? PROMO_ERROR_KEY[err.code] : undefined;
        if (promoKey) {
          setFieldErrors({ promoCode: t(promoKey) });
          return;
        }
        if (err.status === 409) {
          setFormError(t('emailTaken'));
          return;
        }
      }
      setFormError(err instanceof Error ? err.message : t('emailTaken'));
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
          <Label htmlFor="promoCode">{t('promoCode')}</Label>
          <div className="relative">
            <Ticket className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              id="promoCode"
              autoComplete="off"
              autoCapitalize="characters"
              spellCheck={false}
              placeholder="ACME2026"
              value={promoCode}
              onChange={(e) => setPromoCode(e.target.value.toUpperCase())}
              aria-invalid={!!fieldErrors.promoCode}
              aria-describedby="promoCodeHint"
              className="pl-9 font-mono tracking-widest"
            />
          </div>
          {resolvedCompany ? (
            <p
              className="flex items-center gap-1.5 text-sm text-primary"
              role="status"
            >
              <Check className="h-4 w-4 shrink-0" />
              <Building2 className="h-4 w-4 shrink-0" />
              <span className="truncate font-medium">{resolvedCompany}</span>
            </p>
          ) : (
            <p id="promoCodeHint" className="text-sm text-muted-foreground">
              {lookup.isFetching ? t('promoCodeChecking') : t('promoCodeHint')}
            </p>
          )}
          <FieldError message={fieldErrors.promoCode} />
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
              {selfRegisterRoleEnum.options.map((r) => (
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
