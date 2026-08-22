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

/** Coarse OS group from a PlatformId, so downloads can be filtered by OS. */
export function osForPlatform(platform: string): 'windows' | 'macos' | 'linux' | 'other' {
  if (platform.startsWith('win')) return 'windows';
  if (platform.startsWith('mac')) return 'macos';
  if (platform.startsWith('linux')) return 'linux';
  return 'other';
}

/**
 * Fire a `download` event carrying both the granular `platform`
 * (e.g. linux-deb) and the coarse `os` (windows/macos/linux) so Umami can be
 * broken down either way. `extra` adds file/source.
 */
export function trackDownload(platform: string, extra?: UmamiData): void {
  trackEvent('download', { platform, os: osForPlatform(platform), ...extra });
}
