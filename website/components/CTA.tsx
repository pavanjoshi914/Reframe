import Link from 'next/link';
import { DownloadIcon, GitHubIcon } from './Icons';
import { site } from '@/lib/site';

export function CTA() {
  return (
    <section className="mx-auto max-w-content px-4 py-20 sm:px-6 lg:px-8">
      <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-brand-600 via-brand-700 to-brand-900 px-6 py-16 text-center shadow-2xl shadow-brand-900/20 sm:px-12">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 bg-[radial-gradient(30rem_16rem_at_50%_0%,rgba(255,255,255,0.2),transparent_70%)]"
        />
        <div className="relative">
          <h2 className="text-balance text-3xl font-bold tracking-tight text-white sm:text-4xl">
            Your next demo deserves better than a raw screen capture
          </h2>
          <p className="mx-auto mt-4 max-w-xl text-brand-100">
            Free forever, open source, and it runs entirely on your machine.
          </p>
          <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <Link
              href="/download"
              className="btn w-full bg-white text-brand-800 shadow-lg hover:bg-brand-50 sm:w-auto"
            >
              <DownloadIcon className="h-4 w-4" />
              Download Reframe
            </Link>
            <a
              href={site.repoUrl}
              target="_blank"
              rel="noreferrer"
              className="btn w-full border border-white/30 text-white hover:bg-white/10 sm:w-auto"
            >
              <GitHubIcon className="h-4 w-4" />
              Star on GitHub
            </a>
          </div>
        </div>
      </div>
    </section>
  );
}
