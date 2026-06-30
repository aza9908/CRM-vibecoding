import { defineRouting } from 'next-intl/routing';
import { createNavigation } from 'next-intl/navigation';

export const locales = ['ru', 'kk', 'en'] as const;
export type Locale = (typeof locales)[number];
export const defaultLocale: Locale = 'ru';

export const routing = defineRouting({
  locales,
  defaultLocale,
  localePrefix: 'as-needed',
});

export const { Link, redirect, usePathname, useRouter, getPathname } =
  createNavigation(routing);
