'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { useAuthStore } from '@/lib/store/auth-store';
import { cn } from '@/lib/utils';
import { CabinetView } from './cabinet-view';
import { MaterialsManager } from '@/components/materials/MaterialsManager';
import { AdminUsersView } from '@/components/admin/admin-users-view';

type Tab = 'overview' | 'materials' | 'admin';

/**
 * "Личный кабинет" — for staff (teacher/methodist/admin), this wraps the
 * personal overview (`CabinetView`), the materials library, and (admin only)
 * user management as tabs on one page instead of three separate sidebar
 * items. Students see the plain overview with no tab bar — their nav still
 * has its own "Полезные ссылки и файлы" entry, unchanged.
 */
export function PersonalCabinetView() {
  const t = useTranslations('cabinet');
  const user = useAuthStore((s) => s.user);
  const isStaff =
    user?.role === 'teacher' || user?.role === 'methodist' || user?.role === 'admin';
  const isAdmin = user?.role === 'admin';
  const [tab, setTab] = useState<Tab>('overview');

  if (!isStaff) {
    return <CabinetView />;
  }

  const tabs: Array<{ id: Tab; label: string }> = [
    { id: 'overview', label: t('tabOverview') },
    { id: 'materials', label: t('tabMaterials') },
    ...(isAdmin ? [{ id: 'admin' as const, label: t('tabAdmin') }] : []),
  ];

  return (
    <div className="flex flex-col gap-6">
      <div className="flex w-fit gap-1 rounded-lg bg-muted p-1 text-sm">
        {tabs.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => setTab(item.id)}
            className={cn(
              'rounded-md px-3 py-1.5 font-medium transition-colors',
              tab === item.id
                ? 'bg-background shadow-sm'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {item.label}
          </button>
        ))}
      </div>

      {tab === 'overview' ? <CabinetView /> : null}
      {tab === 'materials' ? <MaterialsManager /> : null}
      {tab === 'admin' && isAdmin ? <AdminUsersView /> : null}
    </div>
  );
}
