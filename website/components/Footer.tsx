import Link from 'next/link';
import { Logo } from './Logo';
import { GitHubIcon } from './Icons';
import { site } from '@/lib/site';

const columns = [
  {
    title: 'Product',
    links: [
      { href: '/#features', label: 'Features' },
      { href: '/#how-it-works', label: 'How it works' },
      { href: '/download', label: 'Download' },
      { href: '/#faq', label: 'FAQ' }
    ]
  },
  {
    title: 'Project',
    links: [
      { href: site.repoUrl, label: 'Source on GitHub', external: true },
      { href: site.releasesUrl, label: 'Releases', external: true },
      { href: site.issuesUrl, label: 'Report an issue', external: true },
      { href: `${site.repoUrl}/blob/main/README.md`, label: 'Documentation', external: true }
    ]
  },
  {
    title: 'Legal',
    links: [
      { href: '/privacy', label: 'Privacy policy' },
      { href: '/terms', label: 'Terms of service' },
      { href: `${site.repoUrl}/blob/main/LICENSE`, label: 'MIT licence', external: true }
    ]
  }
];

export function Footer() {
  return (
    <footer className="border-t border-ink-100 bg-white dark:border-white/5 dark:bg-ink-950">
      <div className="mx-auto max-w-content px-4 py-14 sm:px-6 lg:px-8">
        <div className="grid gap-10 md:grid-cols-[1.6fr_1fr_1fr_1fr]">
          <div>
            <Logo />
            <p className="mt-4 max-w-xs text-sm leading-relaxed text-ink-600 dark:text-ink-400">
              A simple, open-source tool for creating beautiful screen recordings. Built for creators, developers and
              designers.
            </p>
            <a
              href={site.repoUrl}
              target="_blank"
              rel="noreferrer"
              className="mt-4 inline-flex items-center gap-2 text-sm font-medium text-ink-600 transition hover:text-brand-600 dark:text-ink-400 dark:hover:text-brand-300"
            >
              <GitHubIcon className="h-4 w-4" />
              {site.repo}
            </a>
          </div>

          {columns.map((col) => (
            <div key={col.title}>
              <h3 className="text-sm font-semibold text-ink-900 dark:text-white">{col.title}</h3>
              <ul className="mt-4 space-y-3">
                {col.links.map((link) => (
                  <li key={link.label}>
                    {'external' in link && link.external ? (
                      <a
                        href={link.href}
                        target="_blank"
                        rel="noreferrer"
                        className="text-sm text-ink-600 transition hover:text-brand-600 dark:text-ink-400 dark:hover:text-brand-300"
                      >
                        {link.label}
                      </a>
                    ) : (
                      <Link
                        href={link.href}
                        className="text-sm text-ink-600 transition hover:text-brand-600 dark:text-ink-400 dark:hover:text-brand-300"
                      >
                        {link.label}
                      </Link>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <div className="mt-12 flex flex-col items-center justify-between gap-3 border-t border-ink-100 pt-6 text-sm text-ink-500 dark:border-white/5 dark:text-ink-400 sm:flex-row">
          <p>
            MIT Licence © {new Date().getFullYear()} {site.name}
          </p>
          <p>
            Built by{' '}
            <a
              href={site.author.github}
              target="_blank"
              rel="noreferrer"
              className="font-medium text-ink-700 underline decoration-dotted underline-offset-4 hover:text-brand-600 dark:text-ink-200 dark:hover:text-brand-300"
            >
              {site.author.name}
            </a>
          </p>
        </div>
      </div>
    </footer>
  );
}
