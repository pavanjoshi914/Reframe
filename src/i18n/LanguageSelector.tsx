import { useI18n, LANGS } from './index';

// Compact language picker. Shows each language in its own native name. Used in
// the editor toolbar and the HUD.
export function LanguageSelector({ className = '' }: { className?: string }) {
  const lang = useI18n((s) => s.lang);
  const setLang = useI18n((s) => s.setLang);
  return (
    <select
      value={lang}
      onChange={(e) => setLang(e.target.value)}
      title="Language"
      aria-label="Language"
      className={
        // Tokens, not white-on-white. This component is shared with the HUD,
        // whose document never gets a data-theme attribute — so it falls back
        // to the :root dark values and stays dark, while the editor follows
        // whatever theme is set.
        'cursor-pointer rounded-md border border-[var(--stroke)] bg-[var(--fill)] px-2 py-1 text-xs text-[var(--text)] outline-none hover:bg-[var(--fill-hover)] ' +
        className
      }
    >
      {LANGS.map((l) => (
        <option key={l.code} value={l.code} className="bg-[var(--panel)] text-[var(--text)]">
          {l.native}
        </option>
      ))}
    </select>
  );
}
