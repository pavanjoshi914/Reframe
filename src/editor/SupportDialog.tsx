import { useEffect, useState } from 'react';
import { Heart, X } from 'lucide-react';
import { useT } from '../i18n';
import {
  SPONSOR_URL,
  SPONSOR_PAGE_URL,
  SUPPORT_PROMPT_DISMISSED_KEY,
  SUPPORT_PROMPT_COUNT_KEY,
  SUPPORT_PROMPT_AFTER_EXPORTS
} from '@shared/sponsor';

/**
 * Post-export sponsorship prompt.
 *
 * Rules it follows, so it stays a nudge rather than nagware:
 *  - only after an export that actually wrote a file (never after a cancel),
 *  - not until the user has had a couple of successful exports,
 *  - one checkbox that silences it permanently, honoured immediately,
 *  - Escape and the backdrop both dismiss it.
 */

/**
 * Records a successful export and reports whether the prompt has earned the
 * right to appear. Safe to call when storage is unavailable — it just returns
 * false and the user is never bothered.
 */
export function shouldPromptAfterExport(): boolean {
  try {
    if (localStorage.getItem(SUPPORT_PROMPT_DISMISSED_KEY) === '1') return false;
    const next = Number(localStorage.getItem(SUPPORT_PROMPT_COUNT_KEY) ?? '0') + 1;
    localStorage.setItem(SUPPORT_PROMPT_COUNT_KEY, String(next));
    return next >= SUPPORT_PROMPT_AFTER_EXPORTS;
  } catch {
    return false;
  }
}

export function SupportDialog({ onClose }: { onClose: () => void }) {
  const t = useT();
  const [dontShow, setDontShow] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dontShow]);

  function close() {
    if (dontShow) {
      try {
        localStorage.setItem(SUPPORT_PROMPT_DISMISSED_KEY, '1');
      } catch {
        /* the checkbox simply won't persist */
      }
    }
    onClose();
  }

  function open(url: string) {
    void window.api.openExternal(url);
    // Sponsoring is a strong enough signal that we stop asking, whatever the
    // checkbox says — no one wants to be pitched again after they've paid.
    try {
      localStorage.setItem(SUPPORT_PROMPT_DISMISSED_KEY, '1');
    } catch {
      /* ignore */
    }
    onClose();
  }

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 p-6 backdrop-blur-sm"
      onClick={close}
      role="dialog"
      aria-modal="true"
      aria-labelledby="support-title"
    >
      <div
        className="relative w-full max-w-md overflow-hidden rounded-xl border border-white/10 bg-[#16181d] shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          onClick={close}
          aria-label={t('support.close')}
          className="absolute right-3 top-3 flex h-7 w-7 items-center justify-center rounded-md text-white/40 hover:bg-white/10 hover:text-white/80"
        >
          <X size={15} />
        </button>

        <div className="p-6">
          <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-rose-500/15 text-rose-400">
            <Heart size={20} fill="currentColor" />
          </span>

          <h2 id="support-title" className="mt-4 text-lg font-semibold text-white">
            {t('support.title')}
          </h2>
          <p className="mt-2 text-sm leading-relaxed text-white/60">{t('support.body')}</p>

          <div className="mt-5 flex flex-col gap-2">
            <button
              onClick={() => open(SPONSOR_URL)}
              className="flex w-full items-center justify-center gap-2 rounded-md bg-emerald-500 px-4 py-2.5 text-sm font-semibold text-black hover:bg-emerald-400"
            >
              <Heart size={15} fill="currentColor" />
              {t('support.sponsor')}
            </button>
            <button
              onClick={() => open(SPONSOR_PAGE_URL)}
              className="w-full rounded-md border border-white/10 px-4 py-2 text-sm text-white/80 hover:bg-white/5"
            >
              {t('support.otherWays')}
            </button>
          </div>
        </div>

        <div className="flex items-center justify-between gap-4 border-t border-white/5 bg-black/20 px-6 py-3">
          <label className="flex cursor-pointer select-none items-center gap-2 text-xs text-white/50 hover:text-white/70">
            <input
              type="checkbox"
              checked={dontShow}
              onChange={(e) => setDontShow(e.target.checked)}
              className="h-3.5 w-3.5 accent-emerald-500"
            />
            {t('support.dontShowAgain')}
          </label>
          <button onClick={close} className="text-xs text-white/50 hover:text-white/80">
            {t('support.later')}
          </button>
        </div>
      </div>
    </div>
  );
}
