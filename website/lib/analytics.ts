// Umami custom-event tracking. The cloud script (app/layout.tsx) injects
// `window.umami` after it loads, so it's absent during SSR and briefly on first
// paint — always guard. Analytics must never throw into the page.
type UmamiData = Record<string, string | number | boolean>;

declare global {
  interface Window {
    umami?: { track: (event: string, data?: UmamiData) => void };
  }
}

export function trackEvent(event: string, data?: UmamiData): void {
  try {
    window.umami?.track(event, data);
  } catch {
    /* ignore */
  }
}
