import { setRequestLocale } from 'next-intl/server';
import { AppShell } from '@/components/app-shell';
import { OnboardingView } from '@/components/onboarding/onboarding-view';

export default async function OnboardingPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  return (
    <AppShell>
      <main className="container py-8">
        <OnboardingView />
      </main>
    </AppShell>
  );
}
