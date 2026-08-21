'use client';

import { useEffect, useState } from 'react';
import { track } from '@vercel/analytics';
import type { DownloadTarget, PlatformId } from '@/lib/github';
import { AppleIcon, ArrowRightIcon, LinuxIcon, WindowsIcon } from './Icons';
import { CopyField } from './CopyField';

type Tab = 'linux' | 'windows' | 'macos';
type Props = { targets: Record<PlatformId, DownloadTarget> };

const TABS: { id: Tab; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { id: 'linux', label: 'Linux', icon: LinuxIcon },
  { id: 'windows', label: 'Windows', icon: WindowsIcon },
  { id: 'macos', label: 'macOS', icon: AppleIcon }
];

/** Pick the visitor's tab so the right instructions show first. */
function detectTab(): Tab {
  if (typeof navigator === 'undefined') return 'linux';
  const hay = `${navigator.userAgent} ${
    (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData?.platform ?? ''
  }`.toLowerCase();
  if (hay.includes('win')) return 'windows';
  if (hay.includes('mac') || hay.includes('iphone') || hay.includes('ipad')) return 'macos';
  return 'linux';
}

/** A prominent, direct download button for one asset. */
function DownloadCard({
  target,
  title,
  subtitle
}: {
  target: DownloadTarget;
  title: string;
  subtitle: string;
}) {
  const meta = [target.filename, target.sizeMb ? `${target.sizeMb} MB` : null].filter(Boolean).join(' · ');
  // The asset lives on github.com (cross-origin), so the `download` attribute is
  // ignored and the click navigates away — which aborts the analytics beacon
  // before it sends. Fire the event, then start the download a beat later so it
  // flushes first. 200ms is imperceptible and reliable.
  const onDownload = (e: React.MouseEvent) => {
    if (!target.direct) return; // fallback link (releases page) — let it navigate
    e.preventDefault();
    track('download', { platform: target.id, file: target.filename ?? target.id });
    setTimeout(() => {
      window.location.href = target.url;
    }, 200);
  };
  return (
    <a
      href={target.url}
      onClick={onDownload}
      className="group flex items-center justify-between gap-3 rounded-xl border border-ink-200 bg-white px-4 py-3.5 transition hover:border-brand-400 hover:bg-brand-50/50 dark:border-white/10 dark:bg-white/[0.02] dark:hover:border-brand-500/50 dark:hover:bg-white/5"
    >
      <span className="min-w-0">
        <span className="block text-sm font-semibold text-ink-900 dark:text-white">{title}</span>
        <span className="block truncate text-xs text-ink-500 dark:text-ink-400">
          {subtitle}
          {meta ? ` · ${meta}` : ''}
        </span>
      </span>
      <span className="flex shrink-0 items-center gap-1.5 rounded-lg bg-brand-600 px-3 py-1.5 text-xs font-semibold text-white transition group-hover:bg-brand-700">
        Download
        <ArrowRightIcon className="h-3.5 w-3.5 transition group-hover:translate-x-0.5" />
      </span>
    </a>
  );
}

function Note({ children }: { children: React.ReactNode }) {
  return <p className="mt-2 text-xs leading-relaxed text-ink-500 dark:text-ink-400">{children}</p>;
}

function Section({ step, title, children }: { step: string; title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-ink-200 p-5 dark:border-white/10">
      <div className="flex items-center gap-2">
        <span className="rounded-full bg-brand-600/10 px-2 py-0.5 text-xs font-bold text-brand-700 dark:bg-brand-500/15 dark:text-brand-300">
          {step}
        </span>
        <h3 className="text-base font-bold text-ink-900 dark:text-white">{title}</h3>
      </div>
      <div className="mt-4">{children}</div>
    </div>
  );
}

export function DownloadTabs({ targets }: Props) {
  const [tab, setTab] = useState<Tab>('linux');
  useEffect(() => setTab(detectTab()), []);

  const flatpakName = targets['linux-flatpak'].filename ?? 'Reframe-x86_64.flatpak';
  const debName = targets['linux-deb'].filename ?? 'reframe_amd64.deb';

  return (
    <div className="mt-10">
      {/* Tab bar */}
      <div className="flex gap-1.5 rounded-2xl bg-ink-100 p-1.5 dark:bg-white/5">
        {TABS.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            type="button"
            onClick={() => setTab(id)}
            aria-selected={tab === id}
            className={`flex flex-1 items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold transition ${
              tab === id
                ? 'bg-white text-ink-900 shadow-sm dark:bg-white/10 dark:text-white'
                : 'text-ink-500 hover:text-ink-800 dark:text-ink-400 dark:hover:text-ink-200'
            }`}
          >
            <Icon className="h-4 w-4" />
            {label}
          </button>
        ))}
      </div>

      <div className="mt-6 space-y-4">
        {/* ── LINUX ─────────────────────────────────────────────────────── */}
        {tab === 'linux' && (
          <>
            <Section step="1" title="Ubuntu / Debian — .deb">
              <DownloadCard
                target={targets['linux-deb']}
                title="Debian package"
                subtitle="Ubuntu, Debian and derivatives"
              />
              <div className="mt-4">
                <CopyField label="Then install with" value={`sudo apt install ./${debName}`} />
              </div>
              <Note>
                Use <strong>apt</strong>, not <code className="text-brand-600 dark:text-brand-300">sudo dpkg -i</code> —
                dpkg alone won&rsquo;t install the recording dependencies (it stops with an error until you run{' '}
                <code className="text-brand-600 dark:text-brand-300">sudo apt-get install -f</code>). Needs an internet
                connection.
              </Note>
            </Section>

            <Section step="2" title="Fedora, Arch, openSUSE — Flatpak">
              <DownloadCard
                target={targets['linux-flatpak']}
                title="Flatpak bundle"
                subtitle="Any distro with Flatpak — fully self-contained"
              />
              <div className="mt-4">
                <CopyField label="Then install with" value={`flatpak install --user ${flatpakName}`} />
              </div>
              <Note>
                Self-contained — every feature works out of the box, with nothing else to install. Needs{' '}
                <a
                  href="https://flatpak.org/setup/"
                  target="_blank"
                  rel="noreferrer"
                  className="font-medium text-brand-600 underline decoration-dotted underline-offset-4 dark:text-brand-300"
                >
                  Flatpak
                </a>{' '}
                set up on your system.
              </Note>
            </Section>

            <Section step="3" title="Any distro — install script (last resort)">
              <CopyField label="Run" value="curl -fsSL https://getreframe.vercel.app/install.sh | bash" />
              <Note>
                Installs the recording dependencies for whatever distro you&rsquo;re on (apt/dnf/pacman/zypper), fetches
                the app, then verifies capture actually works.{' '}
                <a
                  href="/install.sh"
                  className="font-medium text-brand-600 underline decoration-dotted underline-offset-4 dark:text-brand-300"
                >
                  Read the script
                </a>{' '}
                before piping it to your shell.
              </Note>
            </Section>
          </>
        )}

        {/* ── WINDOWS ───────────────────────────────────────────────────── */}
        {tab === 'windows' && (
          <Section step="1" title="Windows 10 or later (64-bit)">
            <DownloadCard target={targets['windows']} title="Windows installer" subtitle="One-click .exe setup" />
            <Note>
              Run the installer and follow the prompts. It isn&rsquo;t code-signed yet, so Windows SmartScreen may warn
              you — click <strong>More info → Run anyway</strong>.
            </Note>
          </Section>
        )}

        {/* ── MACOS ─────────────────────────────────────────────────────── */}
        {tab === 'macos' && (
          <Section step="1" title="macOS 12 Monterey or later">
            <div className="space-y-3">
              <DownloadCard
                target={targets['mac-arm']}
                title="Apple Silicon"
                subtitle="M1 · M2 · M3 · M4"
              />
              <DownloadCard target={targets['mac-intel']} title="Intel" subtitle="x86-64 Macs" />
            </div>
            <Note>
              Open the .dmg and drag Reframe to Applications. It isn&rsquo;t notarized yet, so on first launch{' '}
              <strong>right-click the app → Open</strong>. If macOS says it&rsquo;s &ldquo;damaged&rdquo;, clear the
              quarantine flag: <code className="text-brand-600 dark:text-brand-300">xattr -cr /Applications/Reframe.app</code>.
            </Note>
          </Section>
        )}
      </div>
    </div>
  );
}
