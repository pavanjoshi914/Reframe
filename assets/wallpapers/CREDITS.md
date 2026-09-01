# Wallpaper credits

`Sidebar.tsx` points here for the source and licence of each bundled
wallpaper. Only what is actually known is recorded — the rest is an open
question, not an implied clearance.

## wallpaper-00.jpg — the default

The warm orange petal image. Taken from openscreen
(github.com/siddharthvaddem/openscreen, `resources/assets/wallpapers/wallpaper1.jpg`,
2000x2000), resampled to 1600x1600 to keep the bundle small. It is square on
purpose: the compositor cover-fits the background, so a square source crops
cleanly to 16:9 and to 9:16 without losing the subject.

It appears to be the macOS Ventura system wallpaper, which would make it
Apple artwork rather than something openscreen was free to relicense.
openscreen ships it anyway. **Before Reframe ships commercially this needs
replacing with something we can point at a licence for** — the file is
self-contained and the default is one import in `store.ts`, so swapping it is
a two-line change.

## wallpaper-01.jpg … wallpaper-18.jpg

Provenance not recorded when they were added (2026-06-06). They match
openscreen's `wallpaper2` … `wallpaper18` visually but are separately
re-encoded files. Same licensing question as above applies until someone
traces them.
