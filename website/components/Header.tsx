import Link from 'next/link';
import { Logo } from './Logo';
import { ThemeToggle } from './ThemeToggle';
import { MobileMenu, type NavLink } from './MobileMenu';
import { GitHubIcon, StarIcon } from './Icons';
import { formatStars, getStarCount } from '@/lib/github';
import { site } from '@/lib/site';

const links: NavLink[] = [
  { href: '/#features', label: 'Features' },
  { href: '/#how-it-works', label: 'How it works' },
  { href: '/download', label: 'Download' },
  { href: '/#faq', label: 'FAQ' }
];

export async function Header() {
  const stars = await getStarCount();

  return (
    <header className="sticky top-0 z-40 border-b border-ink-100 bg-white/80 backdrop-blur-xl dark:border-white/5 dark:bg-ink-950/80">
      <div className="mx-auto flex h-16 max-w-content items-center justify-between px-4 sm:px-6 lg:px-8">
        <Logo />

        <nav className="hidden items-center gap-1 md:flex">
          {links.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="rounded-lg px-3 py-2 text-sm font-medium text-ink-600 transition hover:bg-ink-50 hover:text-ink-900 dark:text-ink-300 dark:hover:bg-white/5 dark:hover:text-white"
            >
              {link.label}
            </Link>
          ))}
        </nav>

        <div className="flex items-center gap-2">
          <a
            href={site.repoUrl}
            target="_blank"
            rel="noreferrer"
            className="hidden items-center gap-2 rounded-lg border border-ink-200 px-3 py-2 text-sm font-medium text-ink-700 transition hover:bg-ink-50 dark:border-white/10 dark:text-ink-200 dark:hover:bg-white/5 sm:inline-flex"
          >
            <GitHubIcon className="h-4 w-4" />
            <span>Star</span>
            {stars !== null ? (
              <span className="flex items-center gap-1 border-l border-ink-200 pl-2 text-ink-500 dark:border-white/10 dark:text-ink-400">
                <StarIcon className="h-3 w-3" />
                {formatStars(stars)}
              </span>
            ) : null}
          </a>
          <ThemeToggle />
          <Link href="/download" className="btn-primary hidden px-4 py-2 md:inline-flex">
            Download
          </Link>
          <MobileMenu links={links} />
        </div>
      </div>
    </header>
  );
}
