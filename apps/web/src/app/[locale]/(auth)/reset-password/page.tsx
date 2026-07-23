import { Suspense } from 'react';
import { setRequestLocale } from 'next-intl/server';
import { ResetPasswordForm } from '@/components/auth/reset-password-form';
import { Spinner } from '@/components/ui/spinner';

/**
 * The form reads the reset token via `useSearchParams`, which forces a client
 * boundary — the Suspense wrapper keeps the route statically renderable.
 */
export default async function ResetPasswordPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  return (
    <Suspense
      fallback={
        <main className="flex min-h-screen items-center justify-center">
          <Spinner />
        </main>
      }
    >
      <ResetPasswordForm />
    </Suspense>
  );
}
