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

## wallpaper-19.jpg, wallpaper-20.jpg — skies

Both from Unsplash, resampled to 2560px wide and stripped of metadata to keep
the bundle small.

- `wallpaper-19.jpg` — peach cumulus at golden hour, by **Billy Huynh**
  (unsplash.com/photos/1501630834273-4b5604d2ee31)
- `wallpaper-20.jpg` — white cumulus against deep blue, by **engin akyurt**
  (unsplash.com/photos/1603437873662-dc1f44901825)

The Unsplash Licence permits commercial use with no attribution required and
no permission needed; it forbids selling unmodified copies and building a
competing stock service. Neither applies here. The photographers are credited
anyway because it costs nothing.

Chosen deliberately over the wallpapers Screendrop ships: those are downloaded
at runtime from a third party's server, credited to named authors, and are not
covered by that repo's CC0 licence — they are not ours to redistribute.

## wallpaper-21.jpg — soft blue sky

Generated with ChatGPT (OpenAI) by the project owner, 1672x941, converted to
JPEG and stripped of metadata. Generated rather than sourced, so there is no
third-party licence to honour and nothing to attribute.

Smaller than the rest of the set (the others are 2560px wide). It is a soft
image with no fine detail, so the upscale to a 1080p or 4K frame costs nothing
visible — but a busier picture at this size would soften.

## wallpaper-22.jpg — night pedestal

Generated with ChatGPT (OpenAI) by the project owner, 1672x941, converted to
JPEG and stripped of metadata. Generated rather than sourced, so there is no
third-party licence to honour and nothing to attribute.

The only wallpaper in the set with a subject rather than a texture: a lit
platform in the lower third, under a starfield and a ring of light. It is built
to sit BEHIND a card — the platform reads as something the card stands on — so
it wants a card that clears the lower third and roughly 30% padding. At full
bleed, or with the card centred low, the platform is what gets covered up.
