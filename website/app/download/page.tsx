import type { Metadata } from 'next';
import { getLatestRelease, type DownloadTarget, type PlatformId } from '@/lib/github';
import { AppleIcon, ArrowRightIcon, GitHubIcon, LinuxIcon, WindowsIcon } from '@/components/Icons';
import { site } from '@/lib/site';

export const revalidate = 3600;

export const metadata: Metadata = {
  title: 'Download — free screen recorder for Mac, Windows and Linux',
  description: `Download ${site.name} free for macOS, Windows and Linux. Open source, no account, no watermark.`
};

type Platform = {
  name: string;
  icon: React.ComponentType<{ className?: string }>;
  requirement: string;
  builds: { id: PlatformId; label: string; hint: string }[];
};

const platforms: Platform[] = [
  {
    name: 'macOS',
    icon: AppleIcon,
    requirement: 'macOS 12 Monterey or later',
    builds: [
      { id: 'mac-arm', label: 'Apple Silicon', hint: 'M1 · M2 · M3 · M4' },
      { id: 'mac-intel', label: 'Intel', hint: 'x86-64' }
    ]
  },
  {
    name: 'Windows',
    icon: WindowsIcon,
    requirement: 'Windows 10 or later (64-bit)',
    builds: [{ id: 'windows', label: 'Installer', hint: '.exe' }]
  },
  {
    name: 'Linux',
    icon: LinuxIcon,
    requirement: 'X11 or Wayland · ffmpeg + GStreamer',
    builds: [
      { id: 'linux-appimage', label: 'AppImage', hint: 'Runs anywhere' },
      { id: 'linux-deb', label: 'Debian / Ubuntu', hint: '.deb' }
    ]
  }
];

function BuildRow({ label, hint, target }: { label: string; hint: string; target: DownloadTarget }) {
  return (
    <a
      href={target.url}
      className="group flex items-center justify-between gap-3 rounded-xl border border-ink-200 px-4 py-3 transition hover:border-brand-400 hover:bg-brand-50/50 dark:border-white/10 dark:hover:border-brand-500/50 dark:hover:bg-white/5"
    >
      <span>
        <span className="block text-sm font-semibold text-ink-900 dark:text-white">{label}</span>
        <span className="block text-xs text-ink-500 dark:text-ink-400">
          {hint}
          {target.sizeMb ? ` · ${target.sizeMb} MB` : ''}
        </span>
      </span>
      <ArrowRightIcon className="h-4 w-4 shrink-0 text-ink-400 transition group-hover:translate-x-0.5 group-hover:text-brand-600" />
    </a>
  );
}

const steps = [
  'Download the installer for your platform.',
  'Open it and follow the prompts — on Linux, mark the AppImage executable (chmod +x) or install the .deb with your package manager.',
  'Grant screen-recording permission (plus microphone and camera if you want them).',
  'Launch Reframe. A small pill toolbar appears near the top of your primary display — that is the HUD. Press record.'
];

export default async function DownloadPage() {
  const release = await getLatestRelease();
  const published = release.publishedAt
    ? new Date(release.publishedAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })
    : null;

  return (
    <div className="mx-auto max-w-content px-4 py-16 sm:px-6 sm:py-20 lg:px-8">
      <div className="mx-auto max-w-2xl text-center">
        <h1 className="text-balance text-4xl font-extrabold tracking-tight text-ink-900 dark:text-white sm:text-5xl">
          Download {site.name}
        </h1>
        <p className="mt-4 text-lg text-ink-600 dark:text-ink-300">
          Free and open source. Available for macOS, Windows and Linux — no account, no watermark.
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

      <div className="mt-12 grid gap-4 md:grid-cols-3">
        {platforms.map((p) => {
          const Icon = p.icon;
          return (
            <div key={p.name} className="surface flex flex-col p-6">
              <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-brand-600/10 text-brand-600 dark:bg-brand-500/15 dark:text-brand-300">
                <Icon className="h-6 w-6" />
              </span>
              <h2 className="mt-4 text-xl font-bold text-ink-900 dark:text-white">{p.name}</h2>
              <p className="mt-1 text-sm text-ink-500 dark:text-ink-400">{p.requirement}</p>
              <div className="mt-5 space-y-2">
                {p.builds.map((b) => (
                  <BuildRow key={b.id} label={b.label} hint={b.hint} target={release.targets[b.id]} />
                ))}
              </div>
            </div>
          );
        })}
      </div>

      <div className="mt-12 grid gap-4 lg:grid-cols-2">
        <div className="surface p-6 sm:p-8">
          <h2 className="text-xl font-bold text-ink-900 dark:text-white">Installing</h2>
          <ol className="mt-4 space-y-4">
            {steps.map((step, i) => (
              <li key={step} className="flex gap-3">
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-brand-600/10 text-xs font-bold text-brand-700 dark:bg-brand-500/15 dark:text-brand-300">
                  {i + 1}
                </span>
                <span className="text-sm leading-relaxed text-ink-600 dark:text-ink-300">{step}</span>
              </li>
            ))}
          </ol>
        </div>

        <div className="space-y-4">
          <div className="surface p-6 sm:p-8">
            <h2 className="text-xl font-bold text-ink-900 dark:text-white">
              macOS says &ldquo;Reframe is damaged&rdquo;
            </h2>
            <p className="mt-3 text-sm leading-relaxed text-ink-600 dark:text-ink-300">
              The macOS build is not code-signed yet, so Gatekeeper quarantines it on download. Right-click the app and
              choose <strong>Open</strong> the first time, or clear the quarantine flag:
            </p>
            <pre className="mt-4 overflow-x-auto rounded-xl bg-ink-950 p-4 text-xs text-ink-100 dark:bg-black/40">
              <code>xattr -cr /Applications/Reframe.app</code>
            </pre>
          </div>

          <div className="surface p-6 sm:p-8">
            <h2 className="text-xl font-bold text-ink-900 dark:text-white">Prefer to build it yourself?</h2>
            <p className="mt-3 text-sm leading-relaxed text-ink-600 dark:text-ink-300">
              Every line of Reframe is on GitHub. Clone it, <code className="text-brand-600 dark:text-brand-300">npm install</code>{' '}
              and <code className="text-brand-600 dark:text-brand-300">npm run start</code>.
            </p>
            <a href={site.repoUrl} target="_blank" rel="noreferrer" className="btn-secondary mt-4">
              <GitHubIcon className="h-4 w-4" />
              View the source
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}
