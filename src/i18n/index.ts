import { create } from 'zustand';

// Lightweight, dependency-free i18n for all four renderers (hud/picker/editor/
// region). Locale files live in ./locales/<code>.ts and are auto-registered via
// Vite glob, so adding a language = dropping in one file. Missing keys fall
// back to English, so partially-translated locales degrade gracefully.

export type LangMeta = { code: string; name: string; native: string; rtl?: boolean };

// The 20 shipped languages — chosen for X/Twitter reach × developer communities.
export const LANGS: LangMeta[] = [
  { code: 'en', name: 'English', native: 'English' },
  { code: 'zh', name: 'Chinese (Simplified)', native: '简体中文' },
  { code: 'es', name: 'Spanish', native: 'Español' },
  { code: 'hi', name: 'Hindi', native: 'हिन्दी' },
  { code: 'pt', name: 'Portuguese', native: 'Português' },
  { code: 'ar', name: 'Arabic', native: 'العربية', rtl: true },
  { code: 'ja', name: 'Japanese', native: '日本語' },
  { code: 'fr', name: 'French', native: 'Français' },
  { code: 'de', name: 'German', native: 'Deutsch' },
  { code: 'ru', name: 'Russian', native: 'Русский' },
  { code: 'id', name: 'Indonesian', native: 'Bahasa Indonesia' },
  { code: 'ko', name: 'Korean', native: '한국어' },
  { code: 'tr', name: 'Turkish', native: 'Türkçe' },
  { code: 'it', name: 'Italian', native: 'Italiano' },
  { code: 'vi', name: 'Vietnamese', native: 'Tiếng Việt' },
  { code: 'fa', name: 'Persian', native: 'فارسی', rtl: true },
  { code: 'pl', name: 'Polish', native: 'Polski' },
  { code: 'nl', name: 'Dutch', native: 'Nederlands' },
  { code: 'uk', name: 'Ukrainian', native: 'Українська' },
  { code: 'th', name: 'Thai', native: 'ไทย' }
];

const RTL = new Set(LANGS.filter((l) => l.rtl).map((l) => l.code));

// Auto-load every locale dictionary (eager so they're in the bundle).
const modules = import.meta.glob('./locales/*.ts', { eager: true }) as Record<
  string,
  { default: Record<string, string> }
>;
const DICTS: Record<string, Record<string, string>> = {};
for (const path in modules) {
  const code = path.match(/\/([a-z-]+)\.ts$/)?.[1];
  if (code) DICTS[code] = modules[path].default || {};
}

const STORAGE_KEY = 'reframe.lang';

function detectLang(): string {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved && DICTS[saved]) return saved;
    const nav = (navigator.language || 'en').slice(0, 2).toLowerCase();
    if (DICTS[nav]) return nav;
  } catch {
    /* ignore */
  }
  return 'en';
}

function applyDir(code: string) {
  try {
    document.documentElement.dir = RTL.has(code) ? 'rtl' : 'ltr';
    document.documentElement.lang = code;
  } catch {
    /* no document (shouldn't happen in renderer) */
  }
}

type I18nState = { lang: string; setLang: (code: string) => void };

export const useI18n = create<I18nState>((set) => {
  const initial = detectLang();
  applyDir(initial);
  return {
    lang: initial,
    setLang: (code) => {
      if (!DICTS[code]) code = 'en';
      try { localStorage.setItem(STORAGE_KEY, code); } catch { /* ignore */ }
      applyDir(code);
      set({ lang: code });
    }
  };
});

// Non-reactive translate (current language). Use inside event handlers / non-
// component code. `vars` substitutes {name} placeholders.
export function t(key: string, vars?: Record<string, string | number>): string {
  const lang = useI18n.getState().lang;
  let s = DICTS[lang]?.[key] ?? DICTS.en?.[key] ?? key;
  if (vars) for (const k in vars) s = s.replace(new RegExp(`\\{${k}\\}`, 'g'), String(vars[k]));
  return s;
}

// Reactive hook — subscribes to the language so the component re-renders when
// it changes. Returns the same `t` signature.
export function useT() {
  // Subscribing to lang is what triggers re-render on language change.
  useI18n((s) => s.lang);
  return t;
}
