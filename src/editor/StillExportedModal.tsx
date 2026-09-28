import { useEffect, useState } from 'react';
import { Check, FolderOpen, X, Copy } from 'lucide-react';
import { useEditor } from './store';
import { useT } from '../i18n';

export function StillExportedModal() {
  const t = useT();
  const notice = useEditor((s) => s.exportedStillNotice);
  const setNotice = useEditor((s) => s.setExportedStillNotice);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!notice) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setNotice(null);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [notice, setNotice]);

  if (!notice) return null;

  const fileName = notice.path.split(/[\\/]/).pop() || notice.path;

  const handleCopyPath = async () => {
    try {
      await navigator.clipboard.writeText(notice.path);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* ignore */
    }
  };

  const handleOpenFolder = () => {
    void window.api.openStillsFolder();
  };

  return (
    <div
      className="fixed inset-0 z-[120] flex items-center justify-center bg-[var(--scrim)] p-4 backdrop-blur-sm animate-in fade-in duration-150"
      onClick={() => setNotice(null)}
      role="dialog"
      aria-modal="true"
    >
      <div
        className="relative w-full max-w-md overflow-hidden rounded-2xl border border-[var(--line)] bg-[var(--panel-2)] shadow-2xl transition-all"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          onClick={() => setNotice(null)}
          aria-label={t('export.close')}
          className="absolute right-3.5 top-3.5 flex h-7 w-7 items-center justify-center rounded-lg text-[var(--faint)] hover:bg-[var(--panel-3)] hover:text-[var(--text)] transition-colors"
        >
          <X size={15} />
        </button>

        <div className="p-6">
          <div className="flex items-center gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-emerald-500/15 text-emerald-400">
              <Check size={20} className="stroke-[2.5]" />
            </span>
            <div className="min-w-0 pr-6">
              <h2 className="text-sm font-semibold text-[var(--text)]">
                {t('export.stillSavedTitle')}
              </h2>
              <p className="truncate text-xs text-[var(--muted)]" title={fileName}>
                {fileName}
              </p>
            </div>
          </div>

          {notice.previewUrl && (
            <div className="mt-4 aspect-video max-h-52 w-full overflow-hidden rounded-xl border border-[var(--line)] bg-[var(--panel)] shadow-inner flex items-center justify-center">
              <img
                src={notice.previewUrl}
                alt="Exported still preview"
                className="h-full w-full object-contain"
              />
            </div>
          )}

          <div className="mt-4 flex items-center justify-between gap-2 rounded-lg border border-[var(--line)] bg-[var(--panel-3)] px-3 py-2 text-xs">
            <span className="truncate font-mono text-[11px] text-[var(--muted)] select-all" title={notice.path}>
              {notice.path}
            </span>
            <button
              onClick={handleCopyPath}
              title={copied ? t('editor.copied') : t('editor.copy')}
              className="flex h-6 w-6 shrink-0 items-center justify-center rounded text-[var(--muted)] hover:bg-[var(--panel)] hover:text-[var(--text)] transition-colors"
            >
              {copied ? <Check size={13} className="text-emerald-400" /> : <Copy size={13} />}
            </button>
          </div>

          <div className="mt-5 flex items-center gap-2">
            <button
              onClick={handleOpenFolder}
              className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-[var(--accent)] px-4 py-2.5 text-xs font-semibold text-[var(--accent-fg)] hover:brightness-110 shadow-sm transition-all"
            >
              <FolderOpen size={15} />
              {t('export.openFolder')}
            </button>
            <button
              onClick={() => setNotice(null)}
              className="rounded-lg border border-[var(--line)] bg-[var(--panel)] px-4 py-2.5 text-xs font-medium text-[var(--muted)] hover:bg-[var(--panel-3)] hover:text-[var(--text)] transition-colors"
            >
              {t('export.close')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
