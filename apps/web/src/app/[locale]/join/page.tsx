'use client';

import * as React from 'react';
import { useTranslations } from 'next-intl';
import { ArrowLeft, ArrowRight } from 'lucide-react';
import { joinSessionSchema } from '@lms/shared';
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

  React.useEffect(() => {
    if (user?.fullName?.trim() && !name) {
      setName(user.fullName.trim());
    }
  }, [user?.fullName, name]);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFieldError(null);

    const normalizedCode = code.trim().toUpperCase();
    const parsed = joinSessionSchema.safeParse({
      code: normalizedCode,
      name: name.trim(),
      ...(user?.id ? { userId: user.id } : {}),
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

    try {
      const result = await join.mutateAsync(parsed.data);
      router.push(`/live/${result.sessionId}`);
    } catch (err) {
      void err;
      setFieldError(t('sessionNotFound'));
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

            {fieldError && (
              <p className="text-sm text-destructive" role="alert">
                {fieldError}
              </p>
            )}

            <Button
              type="submit"
              size="lg"
              className="w-full"
              disabled={join.isPending}
            >
              {join.isPending ? (
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
