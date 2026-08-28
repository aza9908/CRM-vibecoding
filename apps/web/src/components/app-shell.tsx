'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import {
  BookOpen,
  Building2,
  FolderOpen,
  HelpCircle,
  History,
  KeyRound,
  LayoutDashboard,
  LogOut,
  Ticket,
  Wrench,
} from 'lucide-react';
import { Link, usePathname, useRouter } from '@/i18n/routing';
import { useAuthStore } from '@/lib/store/auth-store';
import { useCompleteTour } from '@/lib/api/hooks/use-auth';
import { Brand } from '@/components/brand';
import { ThemeToggle } from '@/components/theme-toggle';
import { LocaleSwitcher } from '@/components/locale-switcher';
import { Button } from '@/components/ui/button';
import { OnboardingTour, type TourStep } from '@/components/tour/onboarding-tour';
import { cn } from '@/lib/utils';

/**
 * Chrome for every authenticated screen: top bar + left nav rail.
 * Nav is role-aware so students never hit teacher-only 403 pages.
 */
export function AppShell({ children }: { children: ReactNode }) {
  const t = useTranslations('nav');
  const ta = useTranslations('admin');
  const tt = useTranslations('tour');
  const pathname = usePathname();
  const router = useRouter();
  const user = useAuthStore((s) => s.user);
  const setUser = useAuthStore((s) => s.setUser);
  const clear = useAuthStore((s) => s.clear);
  const completeTour = useCompleteTour();

  const role = user?.role;
  const isTeacher = role === 'teacher' || role === 'methodist' || role === 'admin';
  const isAdmin = role === 'admin';

  const nav = [
    // "Личный кабинет" now also holds Полезные ссылки/файлы and (for admins)
    // user management as tabs — see PersonalCabinetView — so staff no longer
    // gets separate top-level nav entries for either.
    // `tourId`/`tourText` drive the first-login onboarding tour below — every
    // nav entry doubles as one of its steps, so the tour can never drift
    // from whatever is actually in the sidebar for this role.
    {
      href: '/cabinet',
      label: t('cabinet'),
      icon: LayoutDashboard,
      tourId: 'cabinet',
      tourText: tt('cabinet'),
    },
    ...(isTeacher
      ? [
          {
            href: '/teacher/lessons',
            label: t('lessons'),
            icon: BookOpen,
            tourId: 'lessons',
            tourText: tt('lessonsTeacher'),
          },
        ]
      : [
          {
            href: '/lessons',
            label: t('lessons'),
            icon: BookOpen,
            tourId: 'lessons',
            tourText: tt('lessonsStudent'),
          },
        ]),
    {
      href: '/join',
      label: t('join'),
      icon: KeyRound,
      tourId: 'join',
      tourText: tt('join'),
    },
    ...(isTeacher
      ? []
      : [
          {
            href: '/lessons/past',
            label: t('pastLessons'),
            icon: History,
            tourId: 'past-lessons',
            tourText: tt('pastLessons'),
          },
          {
            href: '/materials',
            label: t('materials'),
            icon: FolderOpen,
            tourId: 'materials',
            tourText: tt('materials'),
          },
        ]),
    {
      href: '/tools',
      label: t('tools'),
      icon: Wrench,
      tourId: 'tools',
      tourText: tt('tools'),
    },
    // Companies + their promo codes: one section, not two. A platform admin
    // sees every company (superset of the per-org view); a regular org
    // admin without platform access sees just their own org's codes.
    ...(user?.isPlatformAdmin
      ? [
          {
            href: '/platform/companies',
            label: t('platformCompanies'),
            icon: Building2,
            tourId: 'companies',
            tourText: tt('companiesPlatform'),
          },
        ]
      : isAdmin
        ? [
            {
              href: '/admin/promo-codes',
              label: ta('promoCodesNavLabel'),
              icon: Ticket,
              tourId: 'companies',
              tourText: tt('companiesOrg'),
            },
          ]
        : []),
  ];

  const tourSteps: TourStep[] = nav.map((item) => ({
    targetId: `nav-${item.tourId}`,
    text: item.tourText,
  }));

  const [tourOpen, setTourOpen] = useState(false);
  // Roles dismissed (skipped or finished) this mount, so an in-flight
  // `completeTour` mutation can't re-open the tour before it resolves — but
  // unlike a single one-shot flag, this still lets a *different* role (e.g.
  // after an admin promotes this user mid-session) auto-open its own tour.
  const dismissedRolesRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!user || !role) return;
    if (tourSteps.length === 0) return;
    if (typeof window !== 'undefined' && window.innerWidth < 640) return;
    if (user.toursCompleted?.includes(role)) return;
    if (dismissedRolesRef.current.has(role)) return;
    setTourOpen(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, role]);

  function finishTour() {
    setTourOpen(false);
    if (role && user) {
      dismissedRolesRef.current.add(role);
      // Update the (persisted) store synchronously, not just on the
      // mutation's onSuccess — AppShell remounts fresh on every
      // client-side navigation (it's rendered per-page, not in a shared
      // layout), so if the user navigates before the request round-trips,
      // the next mount must already see this role as completed or the
      // tour would reopen right after being dismissed.
      if (!user.toursCompleted?.includes(role)) {
        setUser({ ...user, toursCompleted: [...user.toursCompleted, role] });
      }
      completeTour.mutate({ tourId: role });
    }
  }

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
          <Link href="/cabinet" aria-label="AI Research Labs">
            <Brand />
          </Link>
          <div className="flex items-center gap-2">
            <LocaleSwitcher />
            <ThemeToggle />
            {user ? (
              <>
                {tourSteps.length > 0 ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="hidden sm:inline-flex"
                    onClick={() => setTourOpen(true)}
                    aria-label={tt('replay')}
                    title={tt('replay')}
                  >
                    <HelpCircle />
                  </Button>
                ) : null}
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
        {/* `children` stays first in the DOM (and thus first in keyboard/
         * screen-reader tab order, right after the header) — `order-first`
         * on the nav below pulls it left purely visually, so users don't
         * have to tab through the whole nav list to reach the page content
         * on every route. */}
        <div className="min-w-0 flex-1">{children}</div>

        <nav
          aria-label="Main"
          className="sticky top-16 order-first hidden h-[calc(100vh-4rem)] w-56 shrink-0 flex-col gap-1 overflow-y-auto border-r bg-card/60 p-3 sm:flex"
        >
          {nav.map((item) => {
            const active =
              item.href === '/join'
                ? pathname === '/join' || pathname.startsWith('/live')
                : pathname.startsWith(item.href);
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                data-tour-id={`nav-${item.tourId}`}
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

      <OnboardingTour steps={tourSteps} open={tourOpen} onFinish={finishTour} />
    </div>
  );
}
