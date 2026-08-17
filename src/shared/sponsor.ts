// Funding links, in one place so the HUD, the editor and any future surface
// can't drift apart. Opened with window.api.openExternal — never in a
// BrowserWindow, so the user's own browser and session handle it.

export const SPONSOR_URL = 'https://github.com/sponsors/pavanjoshi914';
export const SPONSOR_PAGE_URL = 'https://getreframe.vercel.app/sponsor';

// localStorage flag for "don't show this again" on the post-export prompt.
// Renderer-local on purpose: it's a nag preference, not project state, so it
// doesn't belong in a project file or in main's store.
export const SUPPORT_PROMPT_DISMISSED_KEY = 'reframe.support.dismissed';
// How many successful exports to let pass before asking the first time. The
// prompt should never be the first thing a new user meets.
export const SUPPORT_PROMPT_AFTER_EXPORTS = 2;
export const SUPPORT_PROMPT_COUNT_KEY = 'reframe.support.exportCount';
