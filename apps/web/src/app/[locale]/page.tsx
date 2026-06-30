import { setRequestLocale, getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/routing';
import { Brand } from '@/components/brand';
import { Button } from '@/components/ui/button';

export default async function HomePage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('home');

  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-background px-4 py-16">
      <div className="flex w-full max-w-md flex-col items-center text-center">
        <Brand size="lg" />
        <h1 className="mt-8 text-3xl font-bold tracking-tight text-foreground">
          {t('title')}
        </h1>
        <p className="mt-3 text-base text-muted-foreground">{t('subtitle')}</p>

        <div className="mt-8 flex w-full flex-col gap-3">
          <Button asChild size="lg" className="w-full">
            <Link href="/login">{t('ctaLogin')}</Link>
          </Button>
          <Button asChild size="lg" variant="outline" className="w-full">
            <Link href="/join">{t('ctaJoin')}</Link>
          </Button>
        </div>
      </div>
    </main>
  );
}
