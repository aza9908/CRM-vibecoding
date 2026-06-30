'use client';

import * as React from 'react';
import { Moon, Sun } from 'lucide-react';
import { Button } from '@/components/ui/button';

const STORAGE_KEY = 'lms-theme';

/**
 * Light/dark toggle. Persists to localStorage and flips the `.dark` class on
 * <html>; the inline script in the root layout applies it before paint so there
 * is no flash. No external theme library.
 */
export function ThemeToggle() {
  const [dark, setDark] = React.useState(false);

  React.useEffect(() => {
    setDark(document.documentElement.classList.contains('dark'));
  }, []);

  const toggle = React.useCallback(() => {
    const next = !document.documentElement.classList.contains('dark');
    document.documentElement.classList.toggle('dark', next);
    try {
      localStorage.setItem(STORAGE_KEY, next ? 'dark' : 'light');
    } catch {
      /* ignore */
    }
    setDark(next);
  }, []);

  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      onClick={toggle}
      aria-label={dark ? 'Светлая тема' : 'Тёмная тема'}
    >
      {dark ? <Sun /> : <Moon />}
    </Button>
  );
}
