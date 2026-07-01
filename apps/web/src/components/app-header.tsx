'use client';

import { useTranslations } from 'next-intl';
import { LogOut } from 'lucide-react';
import { Link, usePathname, useRouter } from '@/i18n/routing';
import { useAuthStore } from '@/lib/store/auth-store';
import { Brand } from '@/components/brand';
import { ThemeToggle } from '@/components/theme-toggle';
import { LocaleSwitcher } from '@/components/locale-switcher';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

/**
 * Top app bar for authenticated screens: Lumen brand + primary nav on the left,
 * locale / theme / user on the right. Sticky, hairline-bordered, flat.
 */
export function AppHeader() {
  const t = useTranslations('nav');
  const pathname = usePathname();
  const router = useRouter();
  const user = useAuthStore((s) => s.user);
  const clear = useAuthStore((s) => s.clear);

  const nav = [
    { href: '/cabinet', label: t('cabinet') },
    { href: '/teacher/lessons', label: t('lessons') },
    { href: '/teacher/materials', label: t('materials') },
    { href: '/syllabus', label: t('syllabus') },
    // Company analytics is restricted to org admins / team leads.
    ...(user?.role === 'admin' || user?.role === 'team_lead'
      ? [{ href: '/dashboard/company', label: t('dashboard') }]
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
    <header className="sticky top-0 z-40 border-b bg-card/80 backdrop-blur">
      <div className="container flex h-16 items-center justify-between gap-4">
        <div className="flex items-center gap-8">
          <Link href="/teacher/lessons" aria-label="Lumen">
            <Brand />
          </Link>
          <nav className="hidden items-center gap-1 sm:flex">
            {nav.map((item) => {
              const active = pathname.startsWith(item.href);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={cn(
                    'rounded-md px-3 py-2 text-sm font-medium transition-colors',
                    active
                      ? 'bg-accent text-accent-foreground'
                      : 'text-muted-foreground hover:text-foreground',
                  )}
                >
                  {item.label}
                </Link>
              );
            })}
          </nav>
        </div>

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
  );
}
