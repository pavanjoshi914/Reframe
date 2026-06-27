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
        'cursor-pointer rounded-md border border-white/10 bg-white/5 px-2 py-1 text-xs text-white/80 outline-none hover:bg-white/10 ' +
        className
      }
    >
      {LANGS.map((l) => (
        <option key={l.code} value={l.code} className="bg-[#15171c] text-white">
          {l.native}
        </option>
      ))}
    </select>
  );
}
