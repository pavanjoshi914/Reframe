import { useEffect, useState } from 'react';

/**
 * In-app "update available" window. Replaces the native dialog.* message boxes:
 * it's styled like the rest of Reframe, shows what's new as bullets (pulled from
 * the GitHub release notes), and its primary action does the right thing for the
 * install format — silent update where the OS allows it (Windows installer,
 * Linux AppImage), otherwise the download page, which pre-selects the user's OS.
 *
 * All data arrives from main via `update:info`; all actions go back via IPC.
 */

type UpdateInfo = {
  current: string;
  latest: string;
  notes: string[];          // bullet points parsed from the release body
  notesUrl: string;         // the GitHub release page
  mode: 'silent' | 'download'; // silent = electron-updater can install it
  required: boolean;        // when true there is no "Later" (hard block)
  state: 'available' | 'downloading' | 'ready' | 'error';
  progress?: number;        // 0..100 while downloading
  error?: string;
};

export function UpdateApp() {
  const [info, setInfo] = useState<UpdateInfo | null>(null);

  useEffect(() => {
    const off = window.updateApi.onInfo(setInfo);
    window.updateApi.ready();
    return off;
  }, []);

  if (!info) return <div className="h-screen w-screen bg-[#0e0f12]" />;

  const primaryLabel =
    info.state === 'downloading'
      ? `Downloading… ${Math.round(info.progress ?? 0)}%`
      : info.state === 'ready'
        ? 'Restart to update'
        : info.mode === 'silent'
          ? 'Update now'
          : 'Get the update';

  const primaryDisabled = info.state === 'downloading';

  const onPrimary = () => {
    if (info.state === 'ready') return window.updateApi.install();
    if (info.mode === 'silent') return window.updateApi.download();
    return window.updateApi.openDownloadPage();
  };

  return (
    <div className="flex h-screen w-screen flex-col bg-[#0e0f12] text-white" style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}>
      {/* Header */}
      <div className="flex items-start gap-4 px-7 pb-4 pt-7">
        <img src="./assets/logo-transparent.png" alt="" className="h-12 w-12 shrink-0" />
        <div className="min-w-0 flex-1">
          <p className="text-xs font-semibold uppercase tracking-widest text-violet-300/80">Update available</p>
          <h1 className="mt-1 text-2xl font-bold tracking-tight">Reframe {info.latest}</h1>
          <p className="mt-1 text-sm text-white/50">
            You have {info.current}.{' '}
            {info.mode === 'silent'
              ? 'The update installs in the background — one click.'
              : 'Grab the new installer from the download page.'}
          </p>
        </div>
      </div>

      {/* What's new */}
      <div className="mx-7 flex-1 overflow-y-auto rounded-xl border border-white/10 bg-white/[0.03] px-5 py-4" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
        <p className="text-xs font-semibold uppercase tracking-widest text-white/40">What&rsquo;s new</p>
        {info.notes.length > 0 ? (
          <ul className="mt-3 space-y-2">
            {info.notes.map((n, i) => (
              <li key={i} className="flex gap-3 text-sm leading-relaxed text-white/85">
                <span aria-hidden="true" className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full bg-violet-400" />
                <span>{n}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-3 text-sm text-white/60">Bug fixes and improvements.</p>
        )}
        <a
          href="#"
          onClick={(e) => { e.preventDefault(); window.updateApi.openExternal(info.notesUrl); }}
          className="mt-4 inline-block text-xs font-medium text-violet-300 underline decoration-dotted underline-offset-4 hover:text-violet-200"
        >
          Full release notes
        </a>
      </div>

      {info.state === 'error' ? (
        <p className="mx-7 mt-3 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-200">
          {info.error ?? 'The update could not be downloaded.'} You can still get it from the download page.
        </p>
      ) : null}

      {/* Download progress bar (silent mode) */}
      {info.state === 'downloading' ? (
        <div className="mx-7 mt-4 h-1.5 overflow-hidden rounded-full bg-white/10">
          <div className="h-full rounded-full bg-gradient-to-r from-violet-500 to-violet-400 transition-[width]" style={{ width: `${info.progress ?? 0}%` }} />
        </div>
      ) : null}

      {/* Actions */}
      <div className="flex items-center justify-end gap-3 px-7 pb-7 pt-5" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
        {!info.required ? (
          <button
            type="button"
            onClick={() => window.updateApi.later()}
            className="rounded-xl border border-white/15 px-5 py-2.5 text-sm font-semibold text-white/80 transition hover:bg-white/5"
          >
            Later
          </button>
        ) : null}
        <button
          type="button"
          onClick={onPrimary}
          disabled={primaryDisabled}
          className="rounded-xl bg-violet-600 px-6 py-2.5 text-sm font-semibold text-white shadow-lg shadow-violet-600/30 transition hover:bg-violet-500 disabled:cursor-wait disabled:opacity-70"
        >
          {primaryLabel}
        </button>
      </div>
    </div>
  );
}
