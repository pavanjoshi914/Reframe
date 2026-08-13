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

## Swapping in real screenshots

The hero and showcase visuals are hand-built CSS illustrations of the editor
(`components/AppMock.tsx` and the `visual()` functions in `components/Showcase.tsx`) so they
stay sharp at any size and work in both themes. To use real captures instead, drop them in
`public/screenshots/` and replace `<AppMock />` in `components/Hero.tsx` with a `next/image`.
