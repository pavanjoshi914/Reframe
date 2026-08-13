'use client';

import { useEffect, useState } from 'react';
import { MoonIcon, SunIcon } from './Icons';

const STORAGE_KEY = 'reframe-theme';

/**
 * Light/dark switch. The initial class is set by the inline script in
 * app/layout.tsx (before paint); this component only syncs its own icon after
 * mount and writes the user's explicit choice to localStorage.
 */
export function ThemeToggle() {
  const [dark, setDark] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setDark(document.documentElement.classList.contains('dark'));
    setMounted(true);
  }, []);

  function toggle() {
    const next = !dark;
    setDark(next);
    document.documentElement.classList.toggle('dark', next);
    try {
      localStorage.setItem(STORAGE_KEY, next ? 'dark' : 'light');
    } catch {
      /* private mode — the toggle still works for this page view */
    }
  }

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={mounted && dark ? 'Switch to light theme' : 'Switch to dark theme'}
      className="flex h-9 w-9 items-center justify-center rounded-lg border border-ink-200 text-ink-600 transition hover:bg-ink-50 dark:border-white/10 dark:text-ink-300 dark:hover:bg-white/10"
    >
      {/* Before mount the rendered icon can't know the theme, so render both
          and let CSS pick — keeps SSR and client markup identical. */}
      <SunIcon className="h-4 w-4 dark:hidden" />
      <MoonIcon className="hidden h-4 w-4 dark:block" />
    </button>
  );
}
