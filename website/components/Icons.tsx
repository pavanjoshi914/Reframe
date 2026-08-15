import type { SVGProps } from 'react';

type IconProps = SVGProps<SVGSVGElement>;

/** Stroke icons share these defaults so every glyph has the same weight. */
function Stroke({ children, ...props }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      {children}
    </svg>
  );
}

export function GitHubIcon(props: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" {...props}>
      <path d="M12 .5C5.73.5.5 5.73.5 12a11.5 11.5 0 0 0 7.86 10.92c.58.1.79-.25.79-.56v-2c-3.2.7-3.88-1.37-3.88-1.37-.53-1.35-1.29-1.71-1.29-1.71-1.06-.72.08-.7.08-.7 1.17.08 1.78 1.2 1.78 1.2 1.04 1.78 2.73 1.27 3.4.97.1-.75.4-1.27.73-1.56-2.56-.29-5.25-1.28-5.25-5.7 0-1.26.45-2.29 1.19-3.1-.12-.29-.52-1.46.11-3.05 0 0 .97-.31 3.18 1.18a11 11 0 0 1 5.8 0c2.2-1.49 3.17-1.18 3.17-1.18.63 1.59.23 2.76.11 3.05.74.81 1.19 1.84 1.19 3.1 0 4.43-2.7 5.4-5.27 5.69.41.36.78 1.06.78 2.14v3.17c0 .31.21.67.8.56A11.5 11.5 0 0 0 23.5 12C23.5 5.73 18.27.5 12 .5Z" />
    </svg>
  );
}

export function AppleIcon(props: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" {...props}>
      <path d="M16.36 12.68c-.02-2.3 1.88-3.4 1.96-3.46-1.07-1.56-2.73-1.78-3.32-1.8-1.41-.14-2.76.83-3.48.83-.72 0-1.83-.81-3-.79-1.55.02-2.98.9-3.78 2.28-1.61 2.8-.41 6.94 1.16 9.21.77 1.11 1.68 2.36 2.88 2.31 1.16-.05 1.6-.75 3-.75s1.79.75 3.01.72c1.24-.02 2.03-1.13 2.79-2.25.88-1.29 1.24-2.54 1.26-2.6-.03-.01-2.42-.93-2.44-3.7ZM14.1 5.9c.64-.78 1.07-1.85.95-2.93-.92.04-2.03.61-2.69 1.38-.59.69-1.11 1.79-.97 2.84 1.02.08 2.07-.52 2.71-1.29Z" />
    </svg>
  );
}

export function WindowsIcon(props: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" {...props}>
      <path d="M3 5.4 10.2 4.4v7.1H3V5.4Zm8.6-1.2L21 3v8.5h-9.4V4.2ZM3 12.9h7.2v7.1L3 19V12.9Zm8.6 0H21V21l-9.4-1.3v-6.8Z" />
    </svg>
  );
}

/**
 * Tux, drawn as one evenodd path: the silhouette plus three holes (two eyes
 * and the belly) so the glyph stays monochrome and reads at 16px.
 */
export function LinuxIcon(props: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" {...props}>
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M12 1.8c-2.4 0-4.2 1.9-4.2 4.3 0 .8.1 1.4-.2 2-.5 1.1-1.6 2.1-2.4 3.5-1 1.6-1.7 3.4-1.7 5.2 0 2.9 2.4 4.8 5.4 5.1h6.2c3-.3 5.4-2.2 5.4-5.1 0-1.8-.7-3.6-1.7-5.2-.8-1.4-1.9-2.4-2.4-3.5-.3-.6-.2-1.2-.2-2 0-2.4-1.8-4.3-4.2-4.3Z M10.3 4.9a1 1.1 0 1 0 0 2.2 1 1.1 0 1 0 0-2.2Z M13.7 4.9a1 1.1 0 1 0 0 2.2 1 1.1 0 1 0 0-2.2Z"
      />
    </svg>
  );
}

export function RecordIcon(props: IconProps) {
  return (
    <Stroke {...props}>
      <rect x="2" y="4" width="20" height="14" rx="2" />
      <path d="M8 21h8" />
      <circle cx="12" cy="11" r="3" fill="currentColor" stroke="none" />
    </Stroke>
  );
}

export function ZoomIcon(props: IconProps) {
  return (
    <Stroke {...props}>
      <circle cx="11" cy="11" r="7" />
      <path d="M11 8v6M8 11h6M20 20l-3.6-3.6" />
    </Stroke>
  );
}

export function BackgroundIcon(props: IconProps) {
  return (
    <Stroke {...props}>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <circle cx="8.5" cy="9.5" r="1.5" />
      <path d="m3 16 4.5-4.5a2 2 0 0 1 2.8 0L15 16" />
      <path d="m14 15 1.8-1.8a2 2 0 0 1 2.8 0L21 15.5" />
    </Stroke>
  );
}

export function AnnotateIcon(props: IconProps) {
  return (
    <Stroke {...props}>
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
    </Stroke>
  );
}

export function ExportIcon(props: IconProps) {
  return (
    <Stroke {...props}>
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <path d="M7 10l5 5 5-5M12 15V3" />
    </Stroke>
  );
}

export function AutoZoomIcon(props: IconProps) {
  return (
    <Stroke {...props}>
      <path d="M4 8V5a1 1 0 0 1 1-1h3M16 4h3a1 1 0 0 1 1 1v3M20 16v3a1 1 0 0 1-1 1h-3M8 20H5a1 1 0 0 1-1-1v-3" />
      <path d="m12 9 1 2 2 1-2 1-1 2-1-2-2-1 2-1Z" />
    </Stroke>
  );
}

export function SpeedIcon(props: IconProps) {
  return (
    <Stroke {...props}>
      <path d="M4 18a8 8 0 1 1 16 0" />
      <path d="m12 14 4-4" />
      <circle cx="12" cy="15" r="1.2" fill="currentColor" stroke="none" />
    </Stroke>
  );
}

export function SpotlightIcon(props: IconProps) {
  return (
    <Stroke {...props}>
      <path d="M9 3h6l4 8H5Z" />
      <path d="M5 11h14v3a7 7 0 0 1-14 0Z" />
    </Stroke>
  );
}

export function BlurIcon(props: IconProps) {
  return (
    <Stroke {...props}>
      <path d="M3 3l18 18" />
      <path d="M10.6 5.3A9.7 9.7 0 0 1 12 5c5 0 9 4.5 9 7 0 .9-.5 2-1.4 3.1M6.4 7.3C4.4 8.8 3 10.8 3 12c0 2.5 4 7 9 7 1.6 0 3-.4 4.3-1.1" />
      <path d="M9.9 9.9a3 3 0 0 0 4.2 4.2" />
    </Stroke>
  );
}

export function CursorIcon(props: IconProps) {
  return (
    <Stroke {...props}>
      <path d="m4 3 7 17 2.5-6.5L20 11 4 3Z" />
    </Stroke>
  );
}

export function WebcamIcon(props: IconProps) {
  return (
    <Stroke {...props}>
      <circle cx="12" cy="10" r="6" />
      <circle cx="12" cy="10" r="2.2" />
      <path d="M6.5 20h11" />
    </Stroke>
  );
}

export function ShieldIcon(props: IconProps) {
  return (
    <Stroke {...props}>
      <path d="M12 22s8-3.5 8-9.5V5.5L12 2.5 4 5.5V12.5C4 18.5 12 22 12 22Z" />
      <path d="m9 12 2 2 4-4" />
    </Stroke>
  );
}

export function GlobeIcon(props: IconProps) {
  return (
    <Stroke {...props}>
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18M12 3c2.5 2.5 3.8 5.6 3.8 9S14.5 18.5 12 21c-2.5-2.5-3.8-5.6-3.8-9S9.5 5.5 12 3Z" />
    </Stroke>
  );
}

export function BoltIcon(props: IconProps) {
  return (
    <Stroke {...props}>
      <path d="M13 2 4 14h7l-1 8 9-12h-7l1-8Z" />
    </Stroke>
  );
}

export function ScissorsIcon(props: IconProps) {
  return (
    <Stroke {...props}>
      <circle cx="6" cy="6" r="2.5" />
      <circle cx="6" cy="18" r="2.5" />
      <path d="M20 4 8.1 16.5M14.5 13.5 20 20M8.1 7.5 12 11" />
    </Stroke>
  );
}

export function ArrowRightIcon(props: IconProps) {
  return (
    <Stroke {...props}>
      <path d="M5 12h14M13 6l6 6-6 6" />
    </Stroke>
  );
}

export function HeartIcon(props: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" {...props}>
      <path d="M12 21s-7.5-4.6-9.6-9.1C.7 8.3 2.6 4.5 6.2 4.5c2 0 3.3 1.1 4 2.1l1.8 2.3 1.8-2.3c.7-1 2-2.1 4-2.1 3.6 0 5.5 3.8 3.8 7.4C19.5 16.4 12 21 12 21Z" />
    </svg>
  );
}

export function StarIcon(props: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" {...props}>
      <path d="m12 2.5 2.9 5.9 6.5.95-4.7 4.58 1.11 6.47L12 17.35 6.19 20.4l1.1-6.47-4.7-4.58 6.5-.95L12 2.5Z" />
    </svg>
  );
}

export function ChevronDownIcon(props: IconProps) {
  return (
    <Stroke {...props}>
      <path d="m6 9 6 6 6-6" />
    </Stroke>
  );
}

export function SunIcon(props: IconProps) {
  return (
    <Stroke {...props}>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
    </Stroke>
  );
}

export function MoonIcon(props: IconProps) {
  return (
    <Stroke {...props}>
      <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z" />
    </Stroke>
  );
}

export function MenuIcon(props: IconProps) {
  return (
    <Stroke {...props}>
      <path d="M4 7h16M4 12h16M4 17h16" />
    </Stroke>
  );
}

export function CloseIcon(props: IconProps) {
  return (
    <Stroke {...props}>
      <path d="M6 6l12 12M18 6 6 18" />
    </Stroke>
  );
}
