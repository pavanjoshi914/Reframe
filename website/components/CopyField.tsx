'use client';

import { useState } from 'react';

/**
 * A read-only address with a copy button. Wallet addresses are the one thing
 * on a donation page that must never be mistyped, so there is no free-text
 * input and the value is always selectable in full.
 */
export function CopyField({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard blocked — the value is selectable by hand */
    }
  }

  return (
    <div>
      <p className="text-xs font-semibold uppercase tracking-widest text-ink-400 dark:text-ink-500">{label}</p>
      <div className="mt-2 flex items-stretch gap-2">
        <code className="flex-1 overflow-x-auto whitespace-nowrap rounded-lg bg-ink-100 px-3 py-2.5 font-mono text-xs text-ink-800 dark:bg-black/40 dark:text-ink-200">
          {value}
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
