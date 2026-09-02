'use client';

import { useEffect, useRef, useState } from 'react';

/**
 * Hero demo clip — a real Reframe export (window capture + wallpaper, padding,
 * shadow, auto zoom and a webcam bubble).
 *
 * Loading strategy, same shape as the reference site but lazier:
 *  - A lightweight WebP poster is the only thing fetched with the page, so it
 *    is what the browser paints for LCP.
 *  - The <video> starts at `preload="none"` and is only upgraded to `auto`
 *    once it scrolls near the viewport, so visitors who never reach it pay
 *    nothing for ~1.5 MB of video.
 *  - It fades in over the poster on `canplaythrough`, so the swap never shows
 *    a blank or half-buffered frame.
 *
 * The clip is silent, so it autoplays muted and loops. Anyone who has asked
 * for reduced motion keeps the still poster and an explicit play button.
 */
export function DemoVideo() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [ready, setReady] = useState(false);
  const [playing, setPlaying] = useState(false);

  useEffect(() => {
    const video = videoRef.current;
    const wrap = wrapRef.current;
    if (!video || !wrap) return;

    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    const onReady = () => {
      setReady(true);
      if (!reduced) {
        // A rejected autoplay (strict browser settings) just leaves the poster
        // and the play button in place.
        video.play().then(
          () => setPlaying(true),
          () => setPlaying(false)
        );
      }
    };

    const start = () => {
      video.preload = 'auto';
      video.load();
      if (video.readyState >= 3) onReady();
      else video.addEventListener('canplaythrough', onReady, { once: true });
    };

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          observer.disconnect();
          start();
        }
      },
      { rootMargin: '400px' }
    );
    observer.observe(wrap);

    return () => {
      observer.disconnect();
      video.removeEventListener('canplaythrough', onReady);
    };
  }, []);

  function toggle() {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) {
      video.play().then(() => setPlaying(true));
    } else {
      video.pause();
      setPlaying(false);
    }
  }

  return (
    <div ref={wrapRef} className="relative aspect-video w-full overflow-hidden rounded-xl bg-ink-950">
      {/* eslint-disable-next-line @next/next/no-img-element -- static asset, already sized */}
      <img
        src="/videos/demo-poster.webp"
        alt="A spreadsheet screen recording re-framed in Reframe: a warm background, rounded corners, a drop shadow and a presenter in a webcam bubble."
        width={1440}
        height={810}
        className={`absolute inset-0 h-full w-full object-cover transition-opacity duration-500 ${
          ready ? 'opacity-0' : 'opacity-100'
        }`}
      />
      <video
        ref={videoRef}
        className={`absolute inset-0 h-full w-full object-cover transition-opacity duration-500 ${
          ready ? 'opacity-100' : 'opacity-0'
        }`}
        preload="none"
        muted
        loop
        playsInline
        aria-label="Reframe demo: a spreadsheet screen recording with auto zoom, a background and a webcam bubble"
      >
        <source src="/videos/demo.webm" type="video/webm" />
        <source src="/videos/demo.mp4" type="video/mp4" />
      </video>

      <button
        type="button"
        onClick={toggle}
        aria-label={playing ? 'Pause the demo' : 'Play the demo'}
        className="absolute bottom-3 right-3 flex h-9 w-9 items-center justify-center rounded-full bg-black/50 text-white opacity-0 backdrop-blur transition hover:bg-black/70 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white group-hover/video:opacity-100"
      >
        {playing ? (
          <svg viewBox="0 0 24 24" className="h-4 w-4" fill="currentColor" aria-hidden="true">
            <path d="M8 5h3v14H8zM13 5h3v14h-3z" />
          </svg>
        ) : (
          <svg viewBox="0 0 24 24" className="h-4 w-4" fill="currentColor" aria-hidden="true">
            <path d="M8 5.5v13l11-6.5z" />
          </svg>
        )}
      </button>
    </div>
  );
}
