# Reframe website

The marketing site for [Reframe](https://github.com/pavanjoshi914/Reframe) — the landing page,
download page and legal pages. It is a self-contained Next.js app that lives inside the Reframe
repo but shares nothing with the Electron project (its own `package.json`, its own lockfile,
its own `node_modules`).

## Stack

Next.js 16 (App Router) · React 19 · TypeScript · Tailwind CSS 3. No UI library, no icon
package — the icons in `components/Icons.tsx` are hand-written SVG.

## Run locally

```bash
cd website
npm install
npm run dev          # http://localhost:3000
```

```bash
npm run build        # production build
npm run start        # serve the production build
npm run typecheck    # tsc --noEmit
```

Requires Node 20+. If your default `node` is older, use nvm (`nvm use 24`).

## Deploying to Vercel

The repo root is the Electron app, so Vercel has to be pointed at this folder:

1. **New Project** → import `pavanjoshi914/Reframe`.
2. Set **Root Directory** to `website`. Vercel then auto-detects Next.js; leave the build and
   output settings on their defaults.
3. Add environment variables (both optional):

   | Variable | Why |
   | --- | --- |
   | `NEXT_PUBLIC_SITE_URL` | Canonical URL used for OG tags and `sitemap.xml`. Set it to the production domain, e.g. `https://reframe.app`. Defaults to `https://reframe.vercel.app`. |
   | `GITHUB_TOKEN` | A classic token with no scopes. Only raises the GitHub API rate limit; the site works fine without it. |

4. Deploy. Every push to `main` that touches `website/` redeploys.

Or from the CLI:

```bash
npm i -g vercel
cd website && vercel        # preview
vercel --prod               # production
```

## How the download links work

`lib/github.ts` fetches `releases/latest` from the GitHub API at build time and revalidates
hourly (`export const revalidate = 3600` on the pages). It matches release assets by extension
and architecture hint, so as long as `electron-builder` keeps producing `.dmg` / `.exe` /
`.AppImage` / `.deb` files, the buttons point straight at them.

When the repo has no published release — or GitHub is unreachable — every button falls back to
the `/releases/latest` page and the version badge is hidden. Nothing breaks.

## Where to edit what

| Change | File |
| --- | --- |
| Repo URL, author, canonical URL | `lib/site.ts` |
| Hero headline and CTA copy | `components/Hero.tsx` |
| Feature grid | `components/Features.tsx` |
| Tabbed "See it in action" panels | `components/Showcase.tsx` |
| FAQ (also feeds the FAQ structured data) | `components/FAQ.tsx` |
| Download cards, requirements, install steps | `app/download/page.tsx` |
| Brand colours | `tailwind.config.ts` |

## Media assets

Everything visual on the site is real output from the app — no mockups, no stock imagery.

### Hero video (`public/videos/`)

`components/DemoVideo.tsx` paints `demo-poster.webp` immediately, keeps the `<video>` at
`preload="none"` until an IntersectionObserver says it is within 400px of the viewport, then
upgrades it to `preload="auto"` and cross-fades on `canplaythrough`. It is silent, so it
autoplays muted and loops; `prefers-reduced-motion` keeps the poster and the play button.

To replace the clip, re-run these against your new source:

```bash
SRC="your-demo.mp4"
# WebM (VP9) — what Chrome and Firefox get
ffmpeg -i "$SRC" -an -vf scale=1440:-2 -c:v libvpx-vp9 -crf 38 -b:v 0 \
  -row-mt 1 -deadline good -cpu-used 1 -g 60 public/videos/demo.webm
# MP4 (H.264) — Safari fallback, +faststart so it streams before it finishes downloading
ffmpeg -i "$SRC" -an -vf scale=1440:-2 -c:v libx264 -profile:v high -crf 26 -preset slow \
  -pix_fmt yuv420p -g 60 -movflags +faststart public/videos/demo.mp4
# Poster — frame 0, so the fade to video is invisible
ffmpeg -i "$SRC" -frames:v 1 -vf scale=1440:-2 -c:v libwebp -quality 82 public/videos/demo-poster.webp
```

`-an` matters: the audio track is dead weight for a muted autoplay loop. The current clip went
from 5.7 MB to 1.4 MB (WebM) / 1.8 MB (MP4) with no visible loss at 1440px.

### Editor screenshots (`public/screenshots/`)

Captured from the running Electron app over the Chrome DevTools Protocol — launch it with
`--remote-debugging-port=9222`, attach to the `editor.html` renderer, drive it (click the
timeline, select a clip, toggle a panel), and call `Page.captureScreenshot`.

There is one per tool the app ships: `zoom`, `trim`, `speed`, `annotations`, `magnify`,
`spotlight` and `blur` for the seven timeline lanes, then `backgrounds`, `cursor`, `webcam`
and `export` for the sidebar panels — plus `hud.webp`, taken with a transparent background
override. `components/Showcase.tsx` groups them into the two tab strips.

One trap when driving the editor: keystrokes land on whatever has focus, and the language
`<select>` in the title bar swallows letter keys and switches the UI language. Click a neutral
spot first, or select existing clips with the mouse instead of using the keyboard shortcuts.

To refresh them, re-capture at 1920×1011 and downscale:

```bash
ffmpeg -i shot.png -vf scale=1600:-2 -c:v libwebp -quality 84 public/screenshots/<name>.webp
```

Keep them at 1600×842 — `components/Showcase.tsx` hard-codes those dimensions, and the panel
renders them full width with a click-to-expand lightbox because the editor UI is dense.
