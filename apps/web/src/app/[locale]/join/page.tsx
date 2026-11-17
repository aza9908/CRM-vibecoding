'use client';

import * as React from 'react';
import { useTranslations } from 'next-intl';
import { ArrowLeft, ArrowRight } from 'lucide-react';
import { joinSessionSchema } from '@lms/shared';
import { ApiError } from '@/lib/api/client';
import { Link, useRouter } from '@/i18n/routing';
import { useJoinSession } from '@/lib/api/hooks/use-sessions';
import { useAuthStore } from '@/lib/store/auth-store';
import { Brand } from '@/components/brand';
import { AppShell } from '@/components/app-shell';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Spinner } from '@/components/ui/spinner';

/**
 * /join — enter a 6-char session code + name. Logged-in users attach userId
 * so Excel reports get ФИО / должность / компания from registration.
 */
export default function JoinPage() {
  const t = useTranslations('join');
  const tc = useTranslations('common');
  const router = useRouter();
  const join = useJoinSession();
  const user = useAuthStore((s) => s.user);

  const [code, setCode] = React.useState('');
  const [name, setName] = React.useState(user?.fullName?.trim() ?? '');
  const [fieldError, setFieldError] = React.useState<string | null>(null);
  const [retrying, setRetrying] = React.useState(false);
  // Contacts for the session report; remembered on this device.
  const [phone, setPhone] = React.useState('');
  const [company, setCompany] = React.useState('');
  const [position, setPosition] = React.useState('');
  React.useEffect(() => {
    const saved = savedContacts();
    setPhone((v) => v || saved.phone);
    setCompany((v) => v || saved.company);
    setPosition((v) => v || saved.position || user?.occupation?.trim() || '');
  }, [user?.occupation]);

  React.useEffect(() => {
    if (user?.fullName?.trim() && !name) {
      setName(user.fullName.trim());
    }
  }, [user?.fullName, name]);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFieldError(null);

    const normalizedCode = code.trim().toUpperCase();
    const clientKey = deviceKey();
    const phoneClean = phone.trim();
    if (!/^\+?[0-9][0-9 ()-]{5,22}$/.test(phoneClean) || phoneClean.replace(/\D/g, '').length < 7) {
      setFieldError(t('validationPhone'));
      return;
    }
    if (!company.trim()) {
      setFieldError(t('validationCompany'));
      return;
    }
    if (!position.trim()) {
      setFieldError(t('validationPosition'));
      return;
    }
    rememberContacts({ phone: phoneClean, company: company.trim(), position: position.trim() });
    const parsed = joinSessionSchema.safeParse({
      phone: phoneClean,
      company: company.trim(),
      position: position.trim(),
      code: normalizedCode,
      name: name.trim(),
      ...(user?.id ? { userId: user.id } : {}),
      ...(clientKey ? { clientKey } : {}),
    });
    if (!parsed.success) {
      const first = parsed.error.issues[0];
      setFieldError(
        first?.path[0] === 'code'
          ? t('validationCode')
          : t('validationName'),
      );
      return;
    }

    // A crowded room on one Wi-Fi drops requests now and then: retry network
    // errors and server hiccups with growing pauses. Safe to repeat — the
    // device key makes the server return the same participant, not a new one.
    const delays = [600, 1200, 2500, 4000, 6000];
    for (let attempt = 0; ; attempt += 1) {
      try {
        const result = await join.mutateAsync(parsed.data);
        setRetrying(false);
        router.push(`/live/${result.sessionId}`);
        return;
      } catch (err) {
        const status = err instanceof ApiError ? err.status : 0;
        if (status === 404 || status === 400) {
          setRetrying(false);
          setFieldError(t('sessionNotFound'));
          return;
        }
        if (attempt >= delays.length) {
          setRetrying(false);
          setFieldError(t('networkFailed'));
          return;
        }
        setRetrying(true);
        const wait = delays[attempt]! + Math.random() * 400;
        await new Promise((r) => setTimeout(r, wait));
      }
    }
  };

  const card = (
    <div className="flex w-full flex-col items-center justify-center gap-8 px-4 py-16">
      {!user && <Brand size="lg" />}

      <Card className="w-full max-w-md">
        <CardHeader className="space-y-2 text-center">
          <CardTitle className="text-2xl">{t('title')}</CardTitle>
          <CardDescription>{t('subtitle')}</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={onSubmit} className="flex flex-col gap-6">
            <div className="space-y-2">
              <Label
                htmlFor="join-code"
                className="text-center text-xs font-medium uppercase tracking-wider text-muted-foreground"
              >
                {t('code')}
              </Label>
              <Input
                id="join-code"
                value={code}
                autoFocus
                autoComplete="off"
                maxLength={6}
                placeholder={t('codePlaceholder')}
                onChange={(e) =>
                  setCode(e.target.value.toUpperCase().replace(/\s/g, ''))
                }
                className="h-16 text-center font-mono text-3xl font-semibold uppercase tracking-[0.5em]"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="join-name">{t('name')}</Label>
              <Input
                id="join-name"
                value={name}
                autoComplete="name"
                placeholder={t('namePlaceholder')}
                onChange={(e) => setName(e.target.value)}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="join-phone">{t('phone')}</Label>
              <Input
                id="join-phone"
                type="tel"
                inputMode="tel"
                value={phone}
                autoComplete="tel"
                placeholder={t('phonePlaceholder')}
                onChange={(e) => setPhone(e.target.value)}
              />
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="join-company">{t('company')}</Label>
                <Input
                  id="join-company"
                  value={company}
                  autoComplete="organization"
                  placeholder={t('companyPlaceholder')}
                  onChange={(e) => setCompany(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="join-position">{t('position')}</Label>
                <Input
                  id="join-position"
                  value={position}
                  autoComplete="organization-title"
                  placeholder={t('positionPlaceholder')}
                  onChange={(e) => setPosition(e.target.value)}
                />
              </div>
            </div>
            <p className="-mt-2 text-xs text-muted-foreground">{t('contactsHint')}</p>

            {fieldError && (
              <p className="text-sm text-destructive" role="alert">
                {fieldError}
              </p>
            )}
            {retrying && !fieldError ? (
              <p className="text-sm text-muted-foreground" role="status" data-join-retrying>
                {t('retrying')}
              </p>
            ) : null}

            <Button
              type="submit"
              size="lg"
              className="w-full"
              disabled={join.isPending || retrying}
            >
              {join.isPending || retrying ? (
                <>
                  <Spinner className="h-4 w-4" />
                  {tc('loading')}
                </>
              ) : (
                <>
                  {t('joinButton')}
                  <ArrowRight className="h-4 w-4" />
                </>
              )}
            </Button>

            {!user && (
              <Button
                asChild
                variant="ghost"
                size="sm"
                className="text-muted-foreground"
              >
                <Link href="/">
                  <ArrowLeft className="h-4 w-4" />
                  {tc('back')}
                </Link>
              </Button>
            )}
          </form>
        </CardContent>
      </Card>
    </div>
  );

  if (user) {
    return <AppShell>{card}</AppShell>;
  }

  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-background">
      {card}
    </main>
  );
}

/**
 * A random key this browser keeps for good (see participants.client_key).
 * Returns null when storage is blocked; joining still works, only without the
 * duplicate protection.
 */
function deviceKey(): string | null {
  try {
    const k = 'lms-device-key';
    let v = window.localStorage.getItem(k);
    if (!v || !/^[A-Za-z0-9-]{16,64}$/.test(v)) {
      v =
        typeof crypto !== 'undefined' && 'randomUUID' in crypto
          ? crypto.randomUUID()
          : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
      window.localStorage.setItem(k, v);
    }
    return v;
  } catch {
    return null;
  }
}

interface Contacts {
  phone: string;
  company: string;
  position: string;
}
const CONTACTS_KEY = 'lms-join-contacts';
function savedContacts(): Contacts {
  try {
    const v = JSON.parse(window.localStorage.getItem(CONTACTS_KEY) ?? 'null') as Partial<Contacts> | null;
    return { phone: v?.phone ?? '', company: v?.company ?? '', position: v?.position ?? '' };
  } catch {
    return { phone: '', company: '', position: '' };
  }
}
function rememberContacts(c: Contacts): void {
  try {
    window.localStorage.setItem(CONTACTS_KEY, JSON.stringify(c));
  } catch {
    /* storage blocked: nothing to remember */
  }
}
