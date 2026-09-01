import Image from 'next/image';
import Link from 'next/link';
import { site } from '@/lib/site';

export function Logo({ className = '' }: { className?: string }) {
  return (
    <Link href="/" aria-label={`${site.name} home`} className={`inline-flex items-center ${className}`}>
      {/* The wordmark is dark ink on transparent — invert only the letters in
          dark mode by swapping to the mark + live text. */}
      <Image src="/logo.png" alt="" width={32} height={32} className="h-8 w-8" priority />
      <span className="ml-2 text-lg font-bold tracking-tight text-ink-900 dark:text-white">{site.name}</span>
      {/* Beta lives on the site and the release title, deliberately not in the
          version string: a semver prerelease suffix would make GitHub's
          /releases/latest skip the release and electron-updater refuse to offer
          it, so shipping "beta" that way would quietly strand everyone on the
          previous build. */}
      <span className="ml-2 rounded-full border border-brand-300 bg-brand-50 px-1.5 py-0.5 text-[10px] font-semibold uppercase leading-none tracking-wide text-brand-700 dark:border-brand-500/40 dark:bg-brand-500/10 dark:text-brand-300">
        Beta
      </span>
    </Link>
  );
}
