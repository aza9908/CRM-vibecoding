'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useTransition } from 'react';
import { usePathname, useRouter } from '@/i18n/routing';
import { locales, type Locale } from '@/i18n/routing';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

const LABELS: Record<Locale, string> = {
  ru: 'Русский',
  kk: 'Қазақша',
  en: 'English',
};

/** Switches the active locale by re-routing the current pathname. */
export function LocaleSwitcher() {
  const locale = useLocale();
  const t = useTranslations('common');
  const router = useRouter();
  const pathname = usePathname();
  const [isPending, startTransition] = useTransition();

  function onChange(next: string) {
    startTransition(() => {
      router.replace(pathname, { locale: next as Locale });
    });
  }

  return (
    <Select value={locale} onValueChange={onChange} disabled={isPending}>
      <SelectTrigger className="h-9 w-[140px]" aria-label={t('language')}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {locales.map((loc) => (
          <SelectItem key={loc} value={loc}>
            {LABELS[loc]}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
