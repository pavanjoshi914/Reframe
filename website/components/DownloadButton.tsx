'use client';

import { useEffect, useState } from 'react';
import { trackEvent } from '@/lib/analytics';
import type { DownloadTarget, PlatformId } from '@/lib/github';
import { AppleIcon, DownloadIcon, WindowsIcon } from './Icons';
import { InstallModal, startDownload } from './InstallModal';

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

/** macOS lies about its arch in userAgent (Apple Silicon Macs report "Intel"),
 *  so we have to infer it. Returns null when we genuinely cannot tell, which
 *  sends the visitor to /download to pick for themselves — always better than
 *  handing an Intel Mac an arm64 build it physically cannot execute.
 *
 *  Verified on an Intel Mac running Sonoma: Safari reports the WebGL renderer
 *  as exactly "Apple GPU". It says that on Apple Silicon too, so that string
 *  proves NOTHING about the architecture. Treating it as Apple Silicon — which
 *  this function used to do — served arm64 to every Intel Safari user, and the
 *  app then refuses to launch with "not supported on this Mac".
 */
function macIsAppleSilicon(): boolean | null {
  try {
    const gl = document.createElement('canvas').getContext('webgl');
    const dbg = gl?.getExtension('WEBGL_debug_renderer_info');
    const renderer = dbg ? String(gl?.getParameter(dbg.UNMASKED_RENDERER_WEBGL)) : '';
    if (!renderer) return null; // masked (e.g. hardened Safari) — can't tell
    // Chrome names the chip: "Apple M1", "Apple M2 Pro", …
    if (/apple\s+m\d/i.test(renderer)) return true;
    // A discrete/integrated PC GPU only ever appears on an Intel Mac.
    if (/intel|amd|radeon|nvidia|geforce/i.test(renderer)) return false;
    // Anything else, "Apple GPU" included, is ambiguous.
    return null;
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
  // Install-instructions modal, shown alongside a direct download.
  const [open, setOpen] = useState(false);

  const direct = choice.kind === 'direct' ? targets[choice.id] : null;
  const href = direct?.url ?? '/download';
  const Icon = choice.mac ? AppleIcon : choice.kind === 'direct' ? WindowsIcon : DownloadIcon;

  // A direct (Windows/macOS) download starts immediately and opens the
  // install-instructions modal alongside it. The /download redirect is a
  // normal client nav, so just track it and let it proceed.
  const onClick = (e: React.MouseEvent) => {
    if (direct) {
      e.preventDefault();
      startDownload(direct, 'hero');
      setOpen(true);
    } else {
      trackEvent('download_page', { source: 'hero' });
    }
  };

  return (
    <>
      <a
        href={href}
        onClick={onClick}
        className={`btn-primary ${className}`}
      >
        <Icon className="h-5 w-5" />
        {choice.label}
        {direct?.sizeMb ? <span className="font-normal text-white/70">· {direct.sizeMb} MB</span> : null}
      </a>
      {open && direct ? <InstallModal target={direct} onClose={() => setOpen(false)} /> : null}
    </>
  );
}
