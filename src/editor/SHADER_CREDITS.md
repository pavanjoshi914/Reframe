# Shader credits

Every shader Reframe ships lives in `src/editor/shaders.ts`. This file records
where each one came from, so anyone reading the code — or reusing it — can see
what is ours and what is owed to someone else.

## Field

**Derived from OpenShaders' "pure field" shader.**

- Source: <https://openshaders.com> — the grid at `/explore`
- Reference shader: [@eodev](https://openshaders.com/@eodev) (#2,220)
- Platform: <https://github.com/openshaders/openshaders> (MIT)

The `field` generator in `shaders.ts` is a reimplementation of the layered-glow
field that OpenShaders mints for each claimed username. The structure is theirs:
iterate a point through a fold matrix, accumulate a reciprocal glow at each
step, tint it along an OKLCH ramp, tonemap, dither.

The geometry constants in `FIELD_PRESETS` — `theta`, `shear`, `shrink`,
`aspectX/Y`, the warp frequencies, and the `centreX/centreY/tilt` that place the
fold origin off the frame — are taken from @eodev's published shader. The hues,
chroma, lightness, layer counts and speeds are Reframe's own, which is what
makes twenty-four presets out of one set of numbers.

The nine **variants** — Pure field, Grain, ASCII, Dither, Halftone, Sparkle,
Liquid, Mosaic, Chroma — are OpenShaders' taxonomy, taken from the rarity filter
on `/explore`. The names and the idea of treating them as traits over one field
are theirs; the implementations are Reframe's, built from the standard technique
for each (ordered Bayer threshold, rotated dot screen, packed 5x5 glyph masks,
radial channel split, and so on).

Ported from GLSL ES 3.00 (WebGL2) to GLSL ES 1.0 (WebGL1) to match this
project's rendering context: no `gl_VertexID` fullscreen-triangle trick, writes
`gl_FragColor` rather than an `out` variable, and the layer loop needs a
compile-time bound with an early break.

> **Note on licence.** OpenShaders' README states: "The platform's license
> covers the platform. Creators will choose the licenses for their own shaders."
> At the time of writing no per-shader licence is published, so this credit is
> given on the basis that both projects are open source and the debt should be
> visible either way. If @eodev or OpenShaders would prefer different wording,
> removal, or a specific licence notice, open an issue and it will be changed.

Three techniques used here are standard published practice rather than anyone's
property, and are implemented from their own descriptions:

- **OKLCH → linear sRGB** — Björn Ottosson's colour space, so a hue sweep keeps
  even perceived lightness instead of darkening through blue.
- **ACES-style filmic tonemap** — the Narkowicz approximation, so overlapping
  glows roll off rather than clipping to white.
- **Blue-noise dither at 1/255** — removes the banding any smooth gradient shows
  on an 8-bit display.

## Aurora, Drift, Waves, Nebula, Silk, Dusk, Fire, Electric, Rays, Beam, Ripple, Peaks, Smoke

Written for Reframe. No external source.

They use the same well-known building blocks as most procedural work — value
noise, fBm, domain warping, reciprocal falloff for glows — none of which
originates with this project, but the shaders themselves do.

## Mesh

Written for Reframe. The still counterpart to `drift`: four soft coloured lights
blended behind glass with the clock frozen at a per-preset phase.

## Wallpapers

See `assets/wallpapers/CREDITS.md`.
