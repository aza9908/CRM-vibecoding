import { setRequestLocale } from 'next-intl/server';
import { ForgotPasswordForm } from '@/components/auth/forgot-password-form';

export default async function ForgotPasswordPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  return <ForgotPasswordForm />;
}
