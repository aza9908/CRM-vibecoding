'use client';

import { useState, type FormEvent } from 'react';
import { useTranslations } from 'next-intl';
import { Ticket } from 'lucide-react';
import { useRedeemPromoCode } from '@/lib/api/hooks';
import { ApiError } from '@/lib/api/client';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';

/**
 * "У вас пока нет курсов" — shown instead of the normal cabinet when the
 * signed-in account has no company yet (TZ_LMS_roles_promocodes.md §5.2).
 * The single field on this screen is the promo code; there is nothing else
 * to decide, matching the doc's "не гадать" requirement.
 */
export function PromoCodeEmptyState() {
  const t = useTranslations('cabinet');
  const redeem = useRedeemPromoCode();
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const trimmed = code.trim();
    if (!trimmed) return;
    setError(null);
    try {
      await redeem.mutateAsync({ promoCode: trimmed });
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) {
        setError(t('invalidPromoCode'));
      } else {
        setError(t('loadError'));
      }
    }
  }

  return (
    <div className="mx-auto flex max-w-md flex-col items-center gap-4 py-24 text-center">
      <Ticket className="h-10 w-10 text-muted-foreground" />
      <div>
        <h1 className="text-lg font-semibold">{t('noCoursesTitle')}</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {t('noCoursesHint')}
        </p>
      </div>
      <form onSubmit={onSubmit} className="flex w-full flex-col gap-2">
        <Input
          value={code}
          onChange={(e) => setCode(e.target.value.toUpperCase())}
          placeholder={t('promoCodePlaceholder')}
          className="text-center uppercase"
          autoFocus
        />
        {error ? <p className="text-sm text-destructive">{error}</p> : null}
        <Button type="submit" disabled={!code.trim() || redeem.isPending}>
          {redeem.isPending ? <Spinner /> : null}
          {t('activateCode')}
        </Button>
      </form>
    </div>
  );
}
