'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { CloseIcon, MenuIcon } from './Icons';

export type NavLink = { href: string; label: string };

export function MobileMenu({ links }: { links: NavLink[] }) {
  const [open, setOpen] = useState(false);

  // Lock the page behind the sheet, and let Escape close it.
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    window.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div className="md:hidden">
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Open menu"
        aria-expanded={open}
        className="flex h-9 w-9 items-center justify-center rounded-lg border border-ink-200 text-ink-600 dark:border-white/10 dark:text-ink-300"
      >
        <MenuIcon className="h-5 w-5" />
      </button>

      {open ? (
        <div className="fixed inset-0 z-50 bg-white dark:bg-ink-950">
          <div className="flex h-16 items-center justify-end px-4 sm:px-6">
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label="Close menu"
              className="flex h-9 w-9 items-center justify-center rounded-lg border border-ink-200 text-ink-600 dark:border-white/10 dark:text-ink-300"
            >
              <CloseIcon className="h-5 w-5" />
            </button>
          </div>
          <nav className="flex flex-col gap-1 px-6 pt-4">
            {links.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                onClick={() => setOpen(false)}
                className="rounded-xl px-3 py-4 text-xl font-semibold text-ink-800 hover:bg-ink-50 dark:text-ink-100 dark:hover:bg-white/5"
              >
                {link.label}
              </Link>
            ))}
            <Link href="/download" onClick={() => setOpen(false)} className="btn-primary mt-6 w-full">
              Download free
            </Link>
          </nav>
        </div>
      ) : null}
    </div>
  );
}
