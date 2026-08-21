'use client';

import { useEffect, useState } from 'react';
import { track } from '@vercel/analytics';
import type { DownloadTarget, PlatformId } from '@/lib/github';
import { AppleIcon, DownloadIcon, WindowsIcon } from './Icons';

type Props = {
  targets: Record<PlatformId, DownloadTarget>;
  className?: string;
};

/**
 * What the hero button should do for this visitor:
 *  - `direct`  — Windows and macOS need no install instructions, so download the
 *                right file in one click straight from the landing page.
 *  - `page`    — Linux (several formats + a dependency step) and anything we
 *                can't pin down go to /download, where the format choice and the
 *                install command live. The macOS `page` case is the fallback for
 *                when a browser hides the GPU string so we can't tell arm vs x64.
 */
type Choice =
  | { kind: 'direct'; id: PlatformId; label: string; mac: boolean }
  | { kind: 'page'; label: string; mac: boolean };

const NEUTRAL: Choice = { kind: 'page', label: 'Download for free', mac: false };

/** macOS lies about its arch in userAgent; the WebGL renderer string doesn't. */
function macIsAppleSilicon(): boolean | null {
  try {
    const gl = document.createElement('canvas').getContext('webgl');
    const dbg = gl?.getExtension('WEBGL_debug_renderer_info');
    const renderer = dbg ? String(gl?.getParameter(dbg.UNMASKED_RENDERER_WEBGL)) : '';
    if (!renderer) return null; // masked (e.g. hardened Safari) — can't tell
    if (/apple\s+m\d/i.test(renderer) || /apple gpu/i.test(renderer)) return true;
    return false; // a real (Intel/AMD) renderer → Intel Mac
  } catch {
    return null;
  }
}

function detect(): Choice {
  if (typeof navigator === 'undefined') return NEUTRAL;
  const ua = navigator.userAgent;
  const platform = (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData?.platform ?? '';
  const hay = `${ua} ${platform}`.toLowerCase();

  if (hay.includes('android') || hay.includes('iphone') || hay.includes('ipad')) return NEUTRAL; // no mobile build
  if (hay.includes('win')) return { kind: 'direct', id: 'windows', label: 'Download for Windows', mac: false };
  if (hay.includes('mac')) {
    const arm = macIsAppleSilicon();
    if (arm === true) return { kind: 'direct', id: 'mac-arm', label: 'Download for macOS', mac: true };
    if (arm === false) return { kind: 'direct', id: 'mac-intel', label: 'Download for macOS', mac: true };
    return { kind: 'page', label: 'Download for macOS', mac: true }; // arch unknown → let them pick
  }
  return NEUTRAL; // Linux + everything else → the download page
}

export function DownloadButton({ targets, className = '' }: Props) {
  // Render the neutral CTA on the server and until the effect runs, so it never
  // flickers a wrong-platform label mid-hydration.
  const [choice, setChoice] = useState<Choice>(NEUTRAL);
  useEffect(() => setChoice(detect()), []);

  const direct = choice.kind === 'direct' ? targets[choice.id] : null;
  const href = direct?.url ?? '/download';
  const Icon = choice.mac ? AppleIcon : choice.kind === 'direct' ? WindowsIcon : DownloadIcon;

  // For a direct (cross-origin) download, fire the event then defer the
  // navigation so the analytics beacon isn't aborted by the page leaving. For
  // the /download redirect, a normal client nav keeps the page alive long
  // enough, so just track and let it proceed.
  const onClick = (e: React.MouseEvent) => {
    if (direct) {
      e.preventDefault();
      track('download', { platform: direct.id, file: direct.filename ?? direct.id, source: 'hero' });
      setTimeout(() => {
        window.location.href = direct.url;
      }, 200);
    } else {
      track('download_page', { source: 'hero' });
    }
  };

  return (
    <a
      href={href}
      onClick={onClick}
      className={`btn-primary ${className}`}
    >
      <Icon className="h-5 w-5" />
      {choice.label}
      {direct?.sizeMb ? <span className="font-normal text-white/70">· {direct.sizeMb} MB</span> : null}
    </a>
  );
}
