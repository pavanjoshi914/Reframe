'use client';

import { useEffect, useState } from 'react';
import type { DownloadTarget, PlatformId } from '@/lib/github';
import { trackDownload } from '@/lib/analytics';
import { AppleIcon, CloseIcon, LinuxIcon, WindowsIcon } from './Icons';

/**
 * Install instructions shown the moment a download starts. Inline notes next
 * to a button get skimmed past; the macOS "damaged" warning in particular
 * loses people who didn't read that they need to clear the quarantine flag.
 * The download itself kicks off on the button click (see startDownload) — the
 * modal is purely the instructions for what to do once the file lands, so it
 * costs the user no extra click.
 */

/**
 * Start the download for an asset and record it. Called by the download
 * buttons themselves (not by the modal) so the file starts immediately. The
 * navigation is deferred a beat so the analytics beacon isn't aborted by the
 * cross-origin jump to GitHub.
 */
export function startDownload(target: DownloadTarget, source: 'hero' | 'download-page'): void {
  trackDownload(target.id, { file: target.filename ?? target.id, source });
  setTimeout(() => { window.location.href = target.url; }, 200);
}

type Step = { text: React.ReactNode; cmd?: string; cmdLabel?: string };

function CopyCmd({ cmd, label }: { cmd: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(cmd);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard blocked — the text is selectable by hand */
    }
  }
  return (
    <div className="mt-2">
      {label ? (
        <p className="mb-1 text-[11px] font-semibold uppercase tracking-widest text-ink-400 dark:text-ink-500">{label}</p>
      ) : null}
      <div className="flex items-stretch gap-2">
        <code className="flex-1 overflow-x-auto whitespace-nowrap rounded-lg bg-ink-100 px-3 py-2 font-mono text-xs text-ink-800 dark:bg-black/40 dark:text-ink-200">
          {cmd}
        </code>
        <button
          type="button"
          onClick={copy}
          className="shrink-0 rounded-lg border border-ink-200 px-3 text-xs font-semibold text-ink-700 transition hover:bg-ink-50 dark:border-white/10 dark:text-ink-200 dark:hover:bg-white/5"
        >
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
    </div>
  );
}

const B = ({ children }: { children: React.ReactNode }) => (
  <strong className="font-semibold text-ink-900 dark:text-white">{children}</strong>
);

function stepsFor(id: PlatformId, filename: string): { title: string; intro?: React.ReactNode; steps: Step[]; warn?: React.ReactNode } {
  switch (id) {
    case 'mac-arm':
    case 'mac-intel':
      return {
        title: 'Installing on macOS',
        intro: (
          <>
            The app isn&rsquo;t notarized yet, so macOS will say it&rsquo;s <B>&ldquo;damaged&rdquo;</B> the first time you
            open it. That is expected — it is not damaged. Two extra steps fix it:
          </>
        ),
        steps: [
          { text: <>Open the downloaded <B>{filename}</B> and drag <B>Reframe</B> into <B>Applications</B>.</> },
          {
            text: (
              <>
                Open <B>Terminal</B> — press <B>⌘ Space</B>, type <B>Terminal</B>, press <B>Return</B>. Paste this line and
                press <B>Return</B> (it clears the quarantine flag; you may be asked for your Mac password):
              </>
            ),
            cmd: 'xattr -cr /Applications/Reframe.app',
            cmdLabel: 'Run in Terminal'
          },
          { text: <>Now open <B>Reframe</B> from Applications. It will launch normally from here on.</> },
          { text: <>On first recording, macOS will ask for <B>Screen Recording</B> permission — allow it in System Settings → Privacy &amp; Security, then relaunch.</> }
        ]
      };
    case 'windows':
      return {
        title: 'Installing on Windows',
        intro: <>The installer isn&rsquo;t code-signed yet, so Windows SmartScreen may show a warning. It is safe to proceed:</>,
        steps: [
          { text: <>Run the downloaded <B>{filename}</B>.</> },
          { text: <>If a blue <B>&ldquo;Windows protected your PC&rdquo;</B> box appears, click <B>More info</B>, then <B>Run anyway</B>.</> },
          { text: <>Follow the installer — Reframe opens when it finishes.</> }
        ]
      };
    case 'linux-deb':
      return {
        title: 'Installing on Ubuntu / Debian',
        intro: <>Install with <B>apt</B> so it pulls the recording dependencies in automatically:</>,
        steps: [
          { text: <>Open a terminal in the folder you downloaded to (usually <B>Downloads</B>).</> },
          {
            text: <>Run this — it installs Reframe <em>and</em> everything it needs (needs an internet connection):</>,
            cmd: `sudo apt install ./${filename}`,
            cmdLabel: 'Run in terminal'
          },
          { text: <>Launch <B>Reframe</B> from your app menu.</> }
        ],
        warn: (
          <>
            Don&rsquo;t use <code className="font-mono text-xs">sudo dpkg -i</code> on its own — it skips the dependencies and
            stops with an error. If you already did, run{' '}
            <code className="font-mono text-xs">sudo apt-get install -f</code> to finish.
          </>
        )
      };
    case 'linux-flatpak':
      return {
        title: 'Installing the Flatpak',
        intro: <>Fully self-contained — every feature works with nothing else to install. Needs Flatpak set up on your system.</>,
        steps: [
          { text: <>Open a terminal in the folder you downloaded to.</> },
          { text: <>Install it:</>, cmd: `flatpak install --user ${filename}`, cmdLabel: 'Run in terminal' },
          { text: <>Run it from your app menu, or:</>, cmd: 'flatpak run app.reframe.desktop' }
        ],
        warn: (
          <>
            No Flatpak yet? Set it up at{' '}
            <a href="https://flatpak.org/setup/" target="_blank" rel="noreferrer" className="underline decoration-dotted underline-offset-2">
              flatpak.org/setup
            </a>{' '}
            first.
          </>
        )
      };
    case 'linux-appimage':
      return {
        title: 'Running the AppImage',
        steps: [
          { text: <>Make it executable (once):</>, cmd: `chmod +x ${filename}`, cmdLabel: 'Run in terminal' },
          { text: <>Run it:</>, cmd: `./${filename}` }
        ],
        warn: (
          <>
            The AppImage can&rsquo;t bundle the recording dependencies. If cursor-hidden recording is unavailable, use the{' '}
            <B>Flatpak</B> or <B>.deb</B> instead, or run the install script.
          </>
        )
      };
  }
}

export function InstallModal({
  target,
  onClose
}: {
  target: DownloadTarget;
  onClose: () => void;
}) {
  const filename = target.filename ?? target.id;
  const { title, intro, steps, warn } = stepsFor(target.id, filename);
  const Icon = target.id.startsWith('mac') ? AppleIcon : target.id === 'windows' ? WindowsIcon : LinuxIcon;

  // Esc closes; lock page scroll while open.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = prev; };
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-4 backdrop-blur-sm sm:items-center"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby="install-modal-title"
    >
      <div
        className="w-full max-w-lg overflow-hidden rounded-2xl border border-ink-200 bg-white shadow-2xl dark:border-white/10 dark:bg-ink-950"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4 border-b border-ink-200 px-6 py-5 dark:border-white/10">
          <div className="flex items-center gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-brand-600/10 text-brand-600 dark:bg-brand-500/15 dark:text-brand-300">
              <Icon className="h-5 w-5" />
            </span>
            <div>
              <h2 id="install-modal-title" className="text-lg font-bold text-ink-900 dark:text-white">{title}</h2>
              <p className="truncate text-xs text-ink-500 dark:text-ink-400">
                <span className="font-medium text-emerald-600 dark:text-emerald-400">Downloading</span> {filename}{target.sizeMb ? ` · ${target.sizeMb} MB` : ''}
              </p>
            </div>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="rounded-lg p-1.5 text-ink-400 transition hover:bg-ink-100 hover:text-ink-700 dark:hover:bg-white/10 dark:hover:text-white">
            <CloseIcon className="h-5 w-5" />
          </button>
        </div>

        <div className="max-h-[60vh] overflow-y-auto px-6 py-5">
          {intro ? <p className="text-sm leading-relaxed text-ink-600 dark:text-ink-300">{intro}</p> : null}
          <ol className="mt-4 space-y-4">
            {steps.map((s, i) => (
              <li key={i} className="flex gap-3">
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-brand-600/10 text-xs font-bold text-brand-700 dark:bg-brand-500/15 dark:text-brand-300">
                  {i + 1}
                </span>
                <div className="min-w-0 flex-1 text-sm leading-relaxed text-ink-700 dark:text-ink-200">
                  {s.text}
                  {s.cmd ? <CopyCmd cmd={s.cmd} label={s.cmdLabel} /> : null}
                </div>
              </li>
            ))}
          </ol>
          {warn ? (
            <p className="mt-5 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2.5 text-xs leading-relaxed text-amber-800 dark:text-amber-200">
              {warn}
            </p>
          ) : null}
        </div>

        <div className="flex items-center justify-between gap-3 border-t border-ink-200 px-6 py-4 dark:border-white/10">
          <p className="text-xs text-ink-500 dark:text-ink-400">
            Didn&rsquo;t start?{' '}
            <a href={target.url} className="font-medium text-brand-600 underline decoration-dotted underline-offset-2 dark:text-brand-300">
              Download again
            </a>
          </p>
          <button type="button" onClick={onClose} className="btn-primary">Got it</button>
        </div>
      </div>
    </div>
  );
}
