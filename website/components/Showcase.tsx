'use client';

import Image from 'next/image';
import { useEffect, useState } from 'react';
import {
  AnnotateIcon,
  AutoZoomIcon,
  BackgroundIcon,
  BlurIcon,
  CloseIcon,
  CursorIcon,
  ExportIcon,
  ScissorsIcon,
  SpeedIcon,
  SpotlightIcon,
  WebcamIcon,
  ZoomIcon
} from './Icons';

type Tab = {
  id: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  /** Which strip the tab sits in: the timeline lanes, or the sidebar panels. */
  group: 'timeline' | 'panel';
  title: string;
  body: string;
  /** Real screenshot of the Reframe editor, 1600×842. */
  src: string;
  alt: string;
};

/**
 * One tab per editing tool the app actually ships: the seven timeline lanes
 * (Zoom, Trim, Annotation, Speed, Magnify, Spotlight, Blur) plus the sidebar
 * panels. Every screenshot is a real capture of the editor in that state.
 */
const TABS: Tab[] = [
  {
    id: 'zoom',
    label: 'Auto zoom',
    icon: AutoZoomIcon,
    group: 'timeline',
    title: 'Zooms that follow your cursor',
    body: 'Reframe records where your pointer went and where you clicked. Hit "Suggest zooms" and it fills the lane with keyframes at the moments that mattered — six 2.2× zooms here, placed automatically. Drag them, restyle them, or add your own with Z.',
    src: '/screenshots/zoom.webp',
    alt: 'The Reframe editor with the zoom lane filled by automatically suggested 2.2× zoom keyframes across the timeline.'
  },
  {
    id: 'trim',
    label: 'Trim',
    icon: ScissorsIcon,
    group: 'timeline',
    title: 'Cut the dead air',
    body: 'Press T to drop a cut at the playhead and drag its edges to swallow the fumbling, the tab-switching and the silence. Trims are non-destructive — the source recording is never touched.',
    src: '/screenshots/trim.webp',
    alt: 'The Reframe editor with a cut region selected on the trim lane of the timeline.'
  },
  {
    id: 'speed',
    label: 'Speed',
    icon: SpeedIcon,
    group: 'timeline',
    title: 'Speed up the boring parts',
    body: 'Press S for a speed ramp over any stretch — 1.5× through a long form fill, back to real time for the payoff. The audio and the cursor follow the ramp with it.',
    src: '/screenshots/speed.webp',
    alt: 'The Reframe editor with a 1.50× speed ramp selected on the speed lane.'
  },
  {
    id: 'annotate',
    label: 'Annotations',
    icon: AnnotateIcon,
    group: 'timeline',
    title: 'Text that appears exactly when you need it',
    body: 'Press A to drop an annotation at the playhead, then set the font, size, weight, alignment, text colour and background. Drag it anywhere on the preview; it fades in and out with its clip.',
    src: '/screenshots/annotations.webp',
    alt: 'The Reframe editor with a text annotation reading "Skip to the good part" on the video and the annotation styling panel open.'
  },
  {
    id: 'magnify',
    label: 'Magnify',
    icon: ZoomIcon,
    group: 'timeline',
    title: 'A lens that trails your pointer',
    body: 'Press M for a magnifier that blows up whatever is under the cursor without moving the frame. Set it to follow the recorded cursor or pin it to a fixed spot, and apply it to the whole video in one click.',
    src: '/screenshots/magnify.webp',
    alt: 'The Reframe editor showing a circular magnifier lens over the video, with follow-cursor tracking options in the sidebar.'
  },
  {
    id: 'spotlight',
    label: 'Spotlight',
    icon: SpotlightIcon,
    group: 'timeline',
    title: 'Dim everything that is not the point',
    body: 'Press L to darken the frame around the region that matters. Like the magnifier it can follow your recorded cursor or hold a fixed position — ideal for walking through a dense UI.',
    src: '/screenshots/spotlight.webp',
    alt: 'The Reframe editor with a spotlight effect darkening the area around the recording.'
  },
  {
    id: 'blur',
    label: 'Blur',
    icon: BlurIcon,
    group: 'timeline',
    title: 'Hide what should not ship',
    body: 'Press B and drag a box over an email address, an API key or a customer name. Blur or pixelate, with adjustable strength — so a good demo never leaks anything.',
    src: '/screenshots/blur.webp',
    alt: 'The Reframe editor with a blur region drawn over part of the recording and blur strength controls in the sidebar.'
  },
  {
    id: 'background',
    label: 'Backgrounds',
    icon: BackgroundIcon,
    group: 'panel',
    title: 'Wallpapers, gradients and padding',
    body: 'Drop the recording onto a bundled wallpaper, a gradient or a solid colour, then tune padding, corner roundness, shadow and background blur. Subtle, Soft and Dramatic presets get you there in one click.',
    src: '/screenshots/backgrounds.webp',
    alt: 'The Reframe editor showing a screen recording on a violet wallpaper, with the wallpaper picker and style presets in the sidebar.'
  },
  {
    id: 'cursor',
    label: 'Cursor',
    icon: CursorIcon,
    group: 'panel',
    title: 'A cursor worth watching',
    body: 'Swap the jittery OS pointer for System, Arrow, Ring or Dot, then set its colour, scale it up to 1.4× and smooth the path. Click highlights draw a ripple everywhere you actually clicked.',
    src: '/screenshots/cursor.webp',
    alt: 'The Reframe editor cursor panel with style, colour, size, smoothing and click highlight controls.'
  },
  {
    id: 'webcam',
    label: 'Webcam & layout',
    icon: WebcamIcon,
    group: 'panel',
    title: 'Put yourself in the frame',
    body: 'Your camera records as its own track, so you can place it afterwards: picture-in-picture in any corner, side by side, or camera only — as a circle, square or rectangle, at whatever size suits.',
    src: '/screenshots/webcam.webp',
    alt: 'The Reframe editor composition panel with layout presets and webcam shape and size controls.'
  },
  {
    id: 'export',
    label: 'Export',
    icon: ExportIcon,
    group: 'panel',
    title: 'MP4, GIF or WebM — no watermark',
    body: 'Pick a format and a quality tier and export straight to disk. GPU-accelerated on macOS and Windows, up to 4K. Need a loop for a README? GIF. Need a small web clip? WebM. Nothing is stamped on your video.',
    src: '/screenshots/export.webp',
    alt: 'The Reframe editor export panel with MP4, WebM and GIF format options, quality tiers and an Export Video button.'
  }
];

const GROUPS: { id: Tab['group']; label: string }[] = [
  { id: 'timeline', label: 'Timeline lanes' },
  { id: 'panel', label: 'Composition & export' }
];

function Lightbox({ tab, onClose }: { tab: Tab; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={tab.title}
      onClick={onClose}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm sm:p-8"
    >
      <button
        type="button"
        onClick={onClose}
        aria-label="Close"
        className="absolute right-4 top-4 flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-white transition hover:bg-white/20"
      >
        <CloseIcon className="h-5 w-5" />
      </button>
      {/* On a phone a 1600px-wide editor capture scaled to fit is unreadable, so
          below `sm` the image keeps a usable width and the box pans instead. */}
      <div className="max-h-full max-w-full overflow-auto" onClick={(e) => e.stopPropagation()}>
        <Image
          src={tab.src}
          alt={tab.alt}
          width={1600}
          height={842}
          className="w-[900px] max-w-none rounded-lg shadow-2xl sm:max-h-[85vh] sm:w-auto sm:max-w-full"
        />
      </div>
    </div>
  );
}

export function Showcase() {
  const [active, setActive] = useState(TABS[0].id);
  const [expanded, setExpanded] = useState<Tab | null>(null);
  const tab = TABS.find((t) => t.id === active) ?? TABS[0];

  return (
    <section id="showcase" className="mx-auto max-w-content px-4 py-20 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-2xl text-center">
        <h2 className="text-3xl font-bold tracking-tight text-ink-900 dark:text-white sm:text-4xl">See it in action</h2>
        <p className="mt-4 text-lg text-ink-600 dark:text-ink-300">
          Eleven real screenshots of the editor — one for every tool it ships with.
        </p>
      </div>

      <div className="mt-10 space-y-4" role="tablist" aria-label="Reframe features">
        {GROUPS.map((group) => (
          <div key={group.id} className="flex flex-col items-center gap-2 sm:flex-row sm:justify-center">
            <span className="text-[11px] font-semibold uppercase tracking-widest text-ink-400 sm:w-40 sm:shrink-0 sm:text-right dark:text-ink-500">
              {group.label}
            </span>
            <div className="flex flex-wrap justify-center gap-2 sm:justify-start">
              {TABS.filter((t) => t.group === group.id).map((t) => {
                const Icon = t.icon;
                const selected = t.id === active;
                return (
                  <button
                    key={t.id}
                    type="button"
                    role="tab"
                    id={`tab-${t.id}`}
                    aria-selected={selected}
                    aria-controls={`panel-${t.id}`}
                    onClick={() => setActive(t.id)}
                    className={`inline-flex items-center gap-2 rounded-full px-3.5 py-2 text-sm font-medium transition ${
                      selected
                        ? 'bg-brand-600 text-white shadow-lg shadow-brand-600/25'
                        : 'border border-ink-200 text-ink-600 hover:bg-ink-50 dark:border-white/10 dark:text-ink-300 dark:hover:bg-white/5'
                    }`}
                  >
                    <Icon className="h-4 w-4" />
                    {t.label}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      <div role="tabpanel" id={`panel-${tab.id}`} aria-labelledby={`tab-${tab.id}`} className="surface mt-8 p-4 sm:p-6">
        <div className="mx-auto max-w-3xl px-2 pb-6 text-center">
          <h3 className="text-2xl font-bold tracking-tight text-ink-900 dark:text-white">{tab.title}</h3>
          <p className="mt-3 text-pretty text-ink-600 dark:text-ink-300">{tab.body}</p>
        </div>

        {/* Full width: these are 1600px-wide captures of a dense editor UI, so
            anything narrower turns the sidebar and timeline into mush. */}
        <button
          type="button"
          key={tab.id}
          onClick={() => setExpanded(tab)}
          className="group relative block w-full animate-fade-up overflow-hidden rounded-xl ring-1 ring-ink-200 transition hover:ring-brand-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 dark:ring-white/10"
        >
          <Image
            src={tab.src}
            alt={tab.alt}
            width={1600}
            height={842}
            sizes="(max-width: 1152px) 100vw, 1088px"
            priority={tab.id === TABS[0].id}
            className="w-full"
          />
          <span className="pointer-events-none absolute bottom-3 right-3 rounded-md bg-black/60 px-2.5 py-1.5 text-xs font-medium text-white opacity-0 backdrop-blur transition group-hover:opacity-100">
            Click to expand
          </span>
        </button>
      </div>

      {expanded ? <Lightbox tab={expanded} onClose={() => setExpanded(null)} /> : null}
    </section>
  );
}
