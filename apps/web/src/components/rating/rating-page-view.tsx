'use client';

import { useAuthStore } from '@/lib/store/auth-store';
import { PromoCodeEmptyState } from '@/components/cabinet/promo-code-empty-state';
import { StaffRatingView } from './staff-rating-view';
import { MyRatingCard } from './my-rating-card';

/** `/rating`: staff get the full table, students their own card. */
export function RatingPageView() {
  const user = useAuthStore((s) => s.user);
  const role = user?.role;
  if (role === 'teacher' || role === 'methodist' || role === 'admin') {
    return <StaffRatingView />;
  }
  if (role !== 'student') return null;
  if (!user?.organizationId) return <PromoCodeEmptyState />;
  return (
    <div className="mx-auto max-w-2xl">
      <MyRatingCard showRules />
    </div>
  );
}
