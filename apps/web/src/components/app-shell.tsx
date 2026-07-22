'use client';

import type { ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import {
  BarChart3,
  BookOpen,
  ClipboardList,
  FolderOpen,
  LayoutDashboard,
  ListChecks,
  LogOut,
  ShieldCheck,
} from 'lucide-react';
import { Link, usePathname, useRouter } from '@/i18n/routing';
import { useAuthStore } from '@/lib/store/auth-store';
import { Brand } from '@/components/brand';
import { ThemeToggle } from '@/components/theme-toggle';
import { LocaleSwitcher } from '@/components/locale-switcher';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

/**
 * Chrome for every authenticated screen: a slim top bar (brand, locale,
 * theme, account) and the primary nav as a vertically-stacked rail docked to
 * the right edge, sticky under the top bar. Replaces the old horizontal nav
 * that lived inside the top bar (`AppHeader`) — same routes, same guards,
 * just re-laid-out per product request.
 *
 * Usage: wrap a page's content instead of rendering `<AppHeader />` as a
 * sibling —
 *   <AppShell><main className="container py-8">...</main></AppShell>
 */
export function AppShell({ children }: { children: ReactNode }) {
  const t = useTranslations('nav');
  const pathname = usePathname();
  const router = useRouter();
  const user = useAuthStore((s) => s.user);
  const clear = useAuthStore((s) => s.clear);

  const isAdmin = user?.role === 'admin';
  const isAdminOrLead = user?.role === 'admin' || user?.role === 'team_lead';

  const nav = [
    { href: '/cabinet', label: t('cabinet'), icon: LayoutDashboard },
    { href: '/teacher/lessons', label: t('lessons'), icon: BookOpen },
    { href: '/teacher/materials', label: t('materials'), icon: FolderOpen },
    { href: '/syllabus', label: t('syllabus'), icon: ListChecks },
    ...(isAdminOrLead
      ? [{ href: '/dashboard/company', label: t('dashboard'), icon: BarChart3 }]
      : []),
    ...(isAdmin
      ? [
          { href: '/admin', label: t('admin'), icon: ShieldCheck },
          { href: '/admin/tasks', label: t('tasks'), icon: ClipboardList },
        ]
      : []),
  ];

  function logout() {
    clear();
    router.push('/login');
  }

  const initial =
    user?.fullName?.trim()?.[0]?.toUpperCase() ??
    user?.email?.[0]?.toUpperCase() ??
    '?';

  return (
    <div className="flex min-h-screen flex-col">
      <header className="sticky top-0 z-40 border-b bg-card/80 backdrop-blur">
        <div className="flex h-16 items-center justify-between gap-4 px-4 sm:px-6">
          <Link href="/dashboard" aria-label="Lumen">
            <Brand />
          </Link>
          <div className="flex items-center gap-2">
            <LocaleSwitcher />
            <ThemeToggle />
            {user ? (
              <>
                <span
                  className="flex h-9 w-9 items-center justify-center rounded-full bg-primary text-sm font-semibold text-primary-foreground"
                  title={user.fullName ?? user.email}
                >
                  {initial}
                </span>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  onClick={logout}
                  aria-label={t('logout')}
                >
                  <LogOut />
                </Button>
              </>
            ) : null}
          </div>
        </div>
      </header>

      <div className="flex flex-1">
        <div className="min-w-0 flex-1">{children}</div>

        <nav
          aria-label="Main"
          className="sticky top-16 hidden h-[calc(100vh-4rem)] w-56 shrink-0 flex-col gap-1 overflow-y-auto border-l bg-card/60 p-3 sm:flex"
        >
          {nav.map((item) => {
            const active = pathname.startsWith(item.href);
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  'flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors',
                  active
                    ? 'bg-accent text-accent-foreground'
                    : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground',
                )}
              >
                <Icon className="h-4 w-4 shrink-0" />
                {item.label}
              </Link>
            );
          })}
        </nav>
      </div>
    </div>
  );
}
