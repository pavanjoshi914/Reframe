import type { Metadata } from 'next';
import { getLatestRelease } from '@/lib/github';
import { GitHubIcon } from '@/components/Icons';
import { DownloadTabs } from '@/components/DownloadTabs';
import { site } from '@/lib/site';

export const revalidate = 3600;

export const metadata: Metadata = {
  title: 'Download — free screen recorder for Mac, Windows and Linux',
  description: `Download ${site.name} free for macOS, Windows and Linux. Open source, no account, no watermark.`
};

export default async function DownloadPage() {
  const release = await getLatestRelease();
  const published = release.publishedAt
    ? new Date(release.publishedAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })
    : null;

  return (
    <div className="mx-auto max-w-3xl px-4 py-16 sm:px-6 sm:py-20 lg:px-8">
      <div className="mx-auto max-w-2xl text-center">
        <h1 className="text-balance text-4xl font-extrabold tracking-tight text-ink-900 dark:text-white sm:text-5xl">
          Download {site.name}
        </h1>
        <p className="mt-4 text-lg text-ink-600 dark:text-ink-300">
          Free and open source. Pick your platform below — no account, no watermark.
        </p>
        {release.version ? (
          <p className="mt-3 text-sm text-ink-500 dark:text-ink-400">
            Latest release{' '}
            <a
              href={release.htmlUrl}
              target="_blank"
              rel="noreferrer"
              className="font-semibold text-brand-600 underline decoration-dotted underline-offset-4 dark:text-brand-300"
            >
              {release.version}
            </a>
            {published ? ` · ${published}` : ''}
          </p>
        ) : (
          <p className="mt-3 text-sm text-ink-500 dark:text-ink-400">
            No published release yet — grab the latest build straight from{' '}
            <a
              href={site.releasesUrl}
              target="_blank"
              rel="noreferrer"
              className="font-semibold text-brand-600 underline decoration-dotted underline-offset-4 dark:text-brand-300"
            >
              GitHub Releases
            </a>
            .
          </p>
        )}
      </div>

      <DownloadTabs targets={release.targets} />

      <div className="surface mt-10 p-6 sm:p-8">
        <h2 className="text-xl font-bold text-ink-900 dark:text-white">Prefer to build it yourself?</h2>
        <p className="mt-3 text-sm leading-relaxed text-ink-600 dark:text-ink-300">
          Every line of Reframe is on GitHub. Clone it,{' '}
          <code className="text-brand-600 dark:text-brand-300">npm install</code> and{' '}
          <code className="text-brand-600 dark:text-brand-300">npm run start</code>.
        </p>
        <a href={site.repoUrl} target="_blank" rel="noreferrer" className="btn-secondary mt-4">
          <GitHubIcon className="h-4 w-4" />
          View the source
        </a>
      </div>
    </div>
  );
}
