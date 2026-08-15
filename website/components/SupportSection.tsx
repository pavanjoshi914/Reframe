import Link from 'next/link';
import { SponsorButton } from './SponsorButton';
import { HeartIcon } from './Icons';
import { funding } from '@/lib/funding';
import { site } from '@/lib/site';

/**
 * One tasteful ask on the homepage. It sits after "how it works" — by then a
 * visitor knows what the app does, which is the only point at which asking for
 * money is reasonable. Deliberately not in the header or the hero, where it
 * would compete with the download.
 */
export function SupportSection() {
  const { goal } = funding;

  return (
    <section id="support" className="mx-auto max-w-content px-4 pb-4 sm:px-6 lg:px-8">
      <div className="surface relative overflow-hidden p-6 sm:p-10">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -right-16 -top-16 h-56 w-56 rounded-full bg-brand-500/10 blur-3xl"
        />

        <div className="relative flex flex-col items-start gap-8 lg:flex-row lg:items-center lg:justify-between">
          <div className="max-w-xl">
            <span className="inline-flex items-center gap-2 rounded-full bg-rose-500/10 px-3 py-1 text-xs font-semibold text-rose-600 dark:bg-rose-400/10 dark:text-rose-300">
              <HeartIcon className="h-3.5 w-3.5" />
              Support development
            </span>

            <h2 className="mt-4 text-balance text-2xl font-bold tracking-tight text-ink-900 dark:text-white sm:text-3xl">
              {site.name} is free, and stays free
            </h2>

            <p className="mt-3 text-pretty leading-relaxed text-ink-600 dark:text-ink-300">
              No paid tier, no trial, no watermark — built and maintained by one person. Sponsorship covers the running
              costs, starting with {goal.inline} so you stop seeing security warnings on install.
            </p>

            <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-center">
              <SponsorButton />
              <Link
                href="/sponsor"
                className="btn-secondary"
              >
                Other ways to help
              </Link>
            </div>
          </div>

          {/* The concrete ask, so the button has a reason next to it. */}
          <div className="w-full shrink-0 rounded-2xl bg-ink-50 p-5 dark:bg-white/[0.04] lg:w-72">
            <p className="text-xs font-semibold uppercase tracking-widest text-ink-400 dark:text-ink-500">
              First funding goal
            </p>
            <p className="mt-2 font-semibold text-ink-900 dark:text-white">{goal.label}</p>
            <ul className="mt-4 space-y-2">
              {goal.items.map((item) => (
                <li key={item.name} className="flex items-baseline justify-between gap-3 text-sm">
                  <span className="text-ink-600 dark:text-ink-300">{item.name}</span>
                  <span className="shrink-0 font-mono text-xs text-ink-500 dark:text-ink-400">{item.cost}</span>
                </li>
              ))}
            </ul>
            <Link
              href="/sponsor"
              className="mt-4 inline-block text-sm font-medium text-brand-600 underline decoration-dotted underline-offset-4 dark:text-brand-300"
            >
              See the full breakdown
            </Link>
          </div>
        </div>
      </div>
    </section>
  );
}
