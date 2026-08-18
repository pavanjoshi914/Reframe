'use client';

import { useEffect, useState } from 'react';
import type { DownloadTarget, PlatformId } from '@/lib/github';
import { AppleIcon, LinuxIcon, WindowsIcon } from './Icons';

type Props = {
  targets: Record<PlatformId, DownloadTarget>;
  className?: string;
};

const LABELS: Record<PlatformId, string> = {
  'mac-arm': 'Download for macOS',
  'mac-intel': 'Download for macOS',
  windows: 'Download for Windows',
  'linux-flatpak': 'Download for Linux',
  'linux-deb': 'Download for Linux',
  'linux-appimage': 'Download for Linux'
};

/**
 * Guesses the visitor's platform so the hero CTA is one click. Everything else
 * stays reachable on /download, and SSR renders the neutral label until the
 * effect runs — so the button is never wrong-looking mid-hydration.
 */
function detect(): PlatformId | null {
  if (typeof navigator === 'undefined') return null;
  const ua = navigator.userAgent;
  const platform = (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData?.platform ?? '';
  const hay = `${ua} ${platform}`.toLowerCase();

  if (hay.includes('android')) return null; // no mobile build
  if (hay.includes('iphone') || hay.includes('ipad')) return null;
  if (hay.includes('win')) return 'windows';
  if (hay.includes('linux')) return 'linux-appimage';
  if (hay.includes('mac')) {
    // Apple Silicon Safari/Chrome still report "Intel Mac OS X"; the WebGL
    // renderer string is the reliable tell.
    try {
      const gl = document.createElement('canvas').getContext('webgl');
      const dbg = gl?.getExtension('WEBGL_debug_renderer_info');
      const renderer = dbg ? String(gl?.getParameter(dbg.UNMASKED_RENDERER_WEBGL)) : '';
      if (/apple\s+m\d/i.test(renderer) || /apple gpu/i.test(renderer)) return 'mac-arm';
    } catch {
      /* fall through to the Intel build */
    }
    return 'mac-intel';
  }
  return null;
}

export function DownloadButton({ targets, className = '' }: Props) {
  const [platform, setPlatform] = useState<PlatformId | null>(null);

  useEffect(() => setPlatform(detect()), []);

  const isLinux = !!platform?.startsWith('linux');
  // Linux has several formats (.deb / Flatpak / script), so send Linux visitors
  // to the tabs to choose rather than force one file. macOS/Windows download
  // the single right asset directly.
  const target = platform && !isLinux ? targets[platform] : null;
  const href = isLinux ? '/download' : (target?.url ?? '/download');
  const label = platform ? LABELS[platform] : 'Download free';
  const Icon = platform === 'windows' ? WindowsIcon : isLinux ? LinuxIcon : platform ? AppleIcon : null;

  return (
    <a href={href} className={`btn-primary ${className}`}>
      {Icon ? <Icon className="h-4 w-4" /> : null}
      {label}
      {target?.sizeMb ? <span className="font-normal text-white/70">· {target.sizeMb} MB</span> : null}
    </a>
  );
}
