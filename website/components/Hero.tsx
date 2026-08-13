import Link from 'next/link';
import { AppMock } from './AppMock';
import { DownloadButton } from './DownloadButton';
import { GitHubIcon } from './Icons';
import { getLatestRelease } from '@/lib/github';
import { site } from '@/lib/site';

export async function Hero() {
  const release = await getLatestRelease();

  return (
    <section className="relative overflow-hidden">
      {/* Ambient brand glow */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 -top-40 h-[36rem] bg-[radial-gradient(45rem_24rem_at_50%_0%,rgba(139,70,249,0.18),transparent_70%)]"
      />

      <div className="relative mx-auto max-w-content px-4 pb-16 pt-16 sm:px-6 sm:pt-24 lg:px-8">
        <div className="mx-auto max-w-3xl text-center">
          <a
            href={site.repoUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-2 rounded-full border border-ink-200 bg-white px-3 py-1 text-xs font-medium text-ink-600 transition hover:border-brand-300 hover:text-brand-700 dark:border-white/10 dark:bg-white/5 dark:text-ink-300 dark:hover:border-brand-500/50 dark:hover:text-brand-200"
          >
            <span className="relative flex h-1.5 w-1.5">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-brand-500 opacity-75" />
              <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-brand-500" />
            </span>
            {release.version ? `${release.version} is out` : 'Open source, MIT licensed'}
            <span aria-hidden="true">→</span>
          </a>

          <h1 className="mt-6 text-balance text-4xl font-extrabold tracking-tight text-ink-900 dark:text-white sm:text-6xl">
            Showcase your next product demo with{' '}
            <span className="bg-gradient-to-r from-brand-500 to-brand-700 bg-clip-text text-transparent dark:from-brand-300 dark:to-brand-500">
              Reframe
            </span>
          </h1>

          <p className="mx-auto mt-6 max-w-2xl text-pretty text-lg text-ink-600 dark:text-ink-300">
            Record your screen, then re-frame it — auto zoom that follows your cursor, beautiful backgrounds,
            annotations and a webcam bubble. Export to MP4, GIF or WebM with no watermark.
          </p>

          <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <DownloadButton targets={release.targets} className="w-full sm:w-auto" />
            <a href={site.repoUrl} target="_blank" rel="noreferrer" className="btn-secondary w-full sm:w-auto">
              <GitHubIcon className="h-4 w-4" />
              View source
            </a>
          </div>

          <p className="mt-4 flex flex-wrap items-center justify-center gap-x-2 gap-y-1 text-sm text-ink-500 dark:text-ink-400">
            <span>Free</span>
            <span aria-hidden="true">·</span>
            <span>Open source</span>
            <span aria-hidden="true">·</span>
            <span>No account required</span>
            <span aria-hidden="true">·</span>
            <Link href="/download" className="underline decoration-dotted underline-offset-4 hover:text-brand-600">
              macOS, Windows &amp; Linux
            </Link>
          </p>
        </div>

        {/* Product preview */}
        <div className="relative mx-auto mt-14 max-w-5xl animate-fade-up">
          <div
            aria-hidden="true"
            className="absolute -inset-x-8 -bottom-8 -top-4 rounded-[2rem] bg-gradient-to-b from-brand-500/20 to-transparent blur-2xl"
          />
          <div className="relative rounded-2xl border border-ink-200/80 bg-white p-2 shadow-2xl shadow-brand-950/10 dark:border-white/10 dark:bg-white/5 dark:shadow-black/40">
            <AppMock />
          </div>
        </div>
      </div>
    </section>
  );
}
