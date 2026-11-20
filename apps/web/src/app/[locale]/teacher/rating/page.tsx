import { setRequestLocale } from 'next-intl/server';
import { AppShell } from '@/components/app-shell';
import { StaffRatingView } from '@/components/rating/staff-rating-view';

export default async function TeacherRatingPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  return (
    <AppShell>
      <main className="container py-8">
        <StaffRatingView />
      </main>
    </AppShell>
  );
}
