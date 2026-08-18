import { site } from './site';

/**
 * GitHub data used by the download cards and the nav star count.
 *
 * Everything here is fetched server-side with ISR (`revalidate`), so the
 * unauthenticated 60 req/hour rate limit is never a problem — Vercel makes at
 * most one call per hour per endpoint. Every call degrades to `null` on
 * failure and the UI falls back to the plain /releases/latest page, so a
 * GitHub outage (or a repo with no releases yet) never breaks the site.
 *
 * Set GITHUB_TOKEN in the Vercel project to raise the rate limit; it is
 * optional and only ever used server-side.
 */

const REVALIDATE_SECONDS = 3600;

type ReleaseAsset = {
  name: string;
  browser_download_url: string;
  size: number;
  download_count: number;
};

type ReleaseResponse = {
  tag_name: string;
  name: string | null;
  published_at: string;
  html_url: string;
  assets: ReleaseAsset[];
};

type RepoResponse = {
  stargazers_count: number;
};

function headers(): HeadersInit {
  const h: Record<string, string> = {
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28'
  };
  if (process.env.GITHUB_TOKEN) h.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  return h;
}

async function gh<T>(path: string): Promise<T | null> {
  try {
    const res = await fetch(`https://api.github.com/repos/${site.repo}${path}`, {
      headers: headers(),
      next: { revalidate: REVALIDATE_SECONDS }
    });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

export type PlatformId =
  | 'mac-arm'
  | 'mac-intel'
  | 'windows'
  | 'linux-flatpak'
  | 'linux-deb'
  | 'linux-appimage';

export type DownloadTarget = {
  id: PlatformId;
  /** Direct asset URL when the release has a matching file, else the releases page. */
  url: string;
  /** True when `url` points at a real uploaded asset rather than the fallback page. */
  direct: boolean;
  /** The asset's filename (e.g. `reframe_0.1.0_amd64.deb`), or null when unmatched. */
  filename: string | null;
  sizeMb: number | null;
};

export type ReleaseInfo = {
  version: string | null;
  publishedAt: string | null;
  htmlUrl: string;
  targets: Record<PlatformId, DownloadTarget>;
};

/**
 * electron-builder names its output predictably, but the exact shape shifts
 * between versions (`Reframe-0.1.0-arm64.dmg`, `Reframe_0.1.0_amd64.deb`, …).
 * Match on extension plus an arch hint rather than on a full filename.
 */
function pickAsset(assets: ReleaseAsset[], id: PlatformId): ReleaseAsset | undefined {
  const lower = assets.map((a) => ({ a, n: a.name.toLowerCase() }));
  const find = (fn: (n: string) => boolean) => lower.find(({ n }) => fn(n))?.a;

  switch (id) {
    case 'mac-arm':
      return find((n) => n.endsWith('.dmg') && (n.includes('arm64') || n.includes('aarch64')));
    case 'mac-intel':
      return (
        find((n) => n.endsWith('.dmg') && (n.includes('x64') || n.includes('x86_64') || n.includes('intel'))) ??
        // A single unsuffixed .dmg is an x64 build.
        find((n) => n.endsWith('.dmg') && !n.includes('arm64') && !n.includes('aarch64'))
      );
    case 'windows':
      return find((n) => n.endsWith('.exe'));
    case 'linux-flatpak':
      return find((n) => n.endsWith('.flatpak'));
    case 'linux-deb':
      return find((n) => n.endsWith('.deb'));
    case 'linux-appimage':
      return find((n) => n.endsWith('.appimage'));
  }
}

const ALL_PLATFORMS: PlatformId[] = [
  'mac-arm',
  'mac-intel',
  'windows',
  'linux-flatpak',
  'linux-deb',
  'linux-appimage'
];

export async function getLatestRelease(): Promise<ReleaseInfo> {
  const release = await gh<ReleaseResponse>('/releases/latest');
  const fallbackUrl = `${site.releasesUrl}/latest`;

  const targets = Object.fromEntries(
    ALL_PLATFORMS.map((id) => {
      const asset = release ? pickAsset(release.assets ?? [], id) : undefined;
      const target: DownloadTarget = asset
        ? {
            id,
            url: asset.browser_download_url,
            direct: true,
            filename: asset.name,
            sizeMb: Math.round((asset.size / 1024 / 1024) * 10) / 10
          }
        : { id, url: release?.html_url ?? fallbackUrl, direct: false, filename: null, sizeMb: null };
      return [id, target];
    })
  ) as Record<PlatformId, DownloadTarget>;

  return {
    version: release?.tag_name ?? null,
    publishedAt: release?.published_at ?? null,
    htmlUrl: release?.html_url ?? fallbackUrl,
    targets
  };
}

export async function getStarCount(): Promise<number | null> {
  const repo = await gh<RepoResponse>('');
  return repo?.stargazers_count ?? null;
}

export function formatStars(count: number): string {
  if (count < 1000) return String(count);
  return `${(count / 1000).toFixed(count < 10_000 ? 1 : 0)}k`;
}
