'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import {
  BarChart3,
  BookOpen,
  FolderOpen,
  ListChecks,
  LogOut,
  Menu,
  X,
  type LucideIcon,
} from 'lucide-react';
import { Link, usePathname, useRouter } from '@/i18n/routing';
import { useAuthStore } from '@/lib/store/auth-store';
import { Brand } from '@/components/brand';
import { ThemeToggle } from '@/components/theme-toggle';
import { LocaleSwitcher } from '@/components/locale-switcher';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
}

/**
 * Top app bar for authenticated screens.
 *
 * Navigation lives in a right-hand drawer rendered as a vertical list rather
 * than a horizontal row of links. Two reasons this is the better shape here:
 * the old row was `hidden sm:flex`, so phones had no navigation at all; and a
 * list scales as sections are added, where a row silently overflows.
 *
 * The drawer is a focus-trapped dialog: Escape closes it, focus is restored to
 * the trigger, and background scroll is locked while it is open.
 */
export function AppHeader() {
  const t = useTranslations('nav');
  const pathname = usePathname();
  const router = useRouter();
  const user = useAuthStore((s) => s.user);
  const clear = useAuthStore((s) => s.clear);

  const [open, setOpen] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  const nav: NavItem[] = [
    { href: '/teacher/lessons', label: t('lessons'), icon: BookOpen },
    { href: '/teacher/materials', label: t('materials'), icon: FolderOpen },
    { href: '/syllabus', label: t('syllabus'), icon: ListChecks },
    // Company analytics is restricted to org admins / team leads.
    ...(user?.role === 'admin' || user?.role === 'team_lead'
      ? [
          {
            href: '/dashboard/company',
            label: t('dashboard'),
            icon: BarChart3,
          },
        ]
      : []),
  ];

  const close = useCallback(() => {
    setOpen(false);
    triggerRef.current?.focus();
  }, []);

  // Close on route change so the drawer never lingers over a new screen.
  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  // Escape to close + focus trap while open.
  useEffect(() => {
    if (!open) return;

    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.preventDefault();
        close();
        return;
      }
      if (e.key !== 'Tab') return;

      const focusables = panelRef.current?.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])',
      );
      if (!focusables?.length) return;

      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }

    document.addEventListener('keydown', onKeyDown);

    const { overflow } = document.body.style;
    document.body.style.overflow = 'hidden';

    // Move focus into the panel once it has mounted.
    const raf = requestAnimationFrame(() => {
      panelRef.current
        ?.querySelector<HTMLElement>('a[href], button:not([disabled])')
        ?.focus();
    });

    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = overflow;
      cancelAnimationFrame(raf);
    };
  }, [open, close]);

  function logout() {
    clear();
    router.push('/login');
  }

  const initial =
    user?.fullName?.trim()?.[0]?.toUpperCase() ??
    user?.email?.[0]?.toUpperCase() ??
    '?';

  return (
    <>
      <header className="sticky top-0 z-40 border-b bg-card/80 backdrop-blur">
        <div className="container flex h-16 items-center justify-between gap-4">
          <Link href="/teacher/lessons" aria-label="Lumen">
            <Brand />
          </Link>

          <div className="flex items-center gap-2">
            <LocaleSwitcher />
            <ThemeToggle />

            {user ? (
              <>
                <span
                  className="hidden h-9 w-9 items-center justify-center rounded-full bg-primary text-sm font-semibold text-primary-foreground sm:flex"
                  title={user.fullName ?? user.email}
                >
                  {initial}
                </span>
                <Button
                  ref={triggerRef}
                  type="button"
                  variant="ghost"
                  size="icon"
                  onClick={() => setOpen(true)}
                  aria-label={t('menu')}
                  aria-expanded={open}
                  aria-haspopup="dialog"
                >
                  <Menu />
                </Button>
              </>
            ) : null}
          </div>
        </div>
      </header>

      {/* ---- right-hand navigation drawer ---- */}
      {open ? (
        <div className="fixed inset-0 z-50">
          <button
            type="button"
            aria-label={t('closeMenu')}
            onClick={close}
            className="drawer-overlay absolute inset-0 h-full w-full cursor-default bg-black/40 backdrop-blur-sm"
          />

          <div
            ref={panelRef}
            role="dialog"
            aria-modal="true"
            aria-label={t('navigation')}
            className={cn(
              'absolute right-0 top-0 flex h-full w-[min(20rem,85vw)] flex-col',
              'border-l bg-card shadow-xl',
              'drawer-panel',
            )}
          >
            {/* header */}
            <div className="flex items-center justify-between gap-3 border-b px-5 py-4">
              <div className="flex min-w-0 items-center gap-3">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary text-sm font-semibold text-primary-foreground">
                  {initial}
                </span>
                <span className="flex min-w-0 flex-col">
                  <span className="truncate text-sm font-medium">
                    {user?.fullName ?? user?.email}
                  </span>
                  {user?.fullName ? (
                    <span className="truncate text-xs text-muted-foreground">
                      {user.email}
                    </span>
                  ) : null}
                </span>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={close}
                aria-label={t('closeMenu')}
                className="shrink-0"
              >
                <X />
              </Button>
            </div>

            {/* vertical nav list */}
            <nav
              className="flex-1 overflow-y-auto px-3 py-4"
              aria-label={t('navigation')}
            >
              <ul className="flex flex-col gap-1">
                {nav.map((item) => {
                  const active = pathname.startsWith(item.href);
                  const Icon = item.icon;
                  return (
                    <li key={item.href}>
                      <Link
                        href={item.href}
                        aria-current={active ? 'page' : undefined}
                        className={cn(
                          'flex items-center gap-3 rounded-md px-3 py-2.5 text-sm font-medium transition-colors',
                          active
                            ? 'bg-accent text-accent-foreground'
                            : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground',
                        )}
                      >
                        <Icon className="h-4 w-4 shrink-0" aria-hidden />
                        <span className="truncate">{item.label}</span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </nav>

            {/* footer */}
            <div className="border-t p-3">
              <Button
                type="button"
                variant="ghost"
                onClick={logout}
                className="w-full justify-start gap-3 px-3 text-muted-foreground hover:text-foreground"
              >
                <LogOut className="h-4 w-4" aria-hidden />
                {t('logout')}
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
