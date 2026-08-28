import { redirect } from '@/i18n/routing';
import type { Locale } from '@/i18n/routing';

/**
 * Bare `/admin` has no page of its own — user management lives in the
 * "Админ" tab under Личный кабинет now (see `PersonalCabinetView`). Anyone
 * hitting this URL directly (a bookmark, a typed guess) is sent to their
 * cabinet instead of hitting a blank 404 — TZ_LMS_roles_promocodes.md §14.4.
 */
export default async function AdminIndexRedirect({
  params,
}: {
  params: Promise<{ locale: Locale }>;
}) {
  const { locale } = await params;
  redirect({ href: '/cabinet', locale });
}
