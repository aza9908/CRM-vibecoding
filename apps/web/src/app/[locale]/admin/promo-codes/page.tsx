import { setRequestLocale } from 'next-intl/server';
import { AppShell } from '@/components/app-shell';
import { PromoCodesView } from '@/components/admin/promo-codes-view';

export default async function AdminPromoCodesPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  return (
    <AppShell>
      <PromoCodesView />
    </AppShell>
  );
}
