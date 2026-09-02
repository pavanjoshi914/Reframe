'use client';

import { useEffect, useRef, useState } from 'react';

/**
 * Scroll-driven hero: the demo clip starts full-bleed, then shrinks into a
 * screenshot of the Reframe editor as you scroll, so the pitch ("this video was
 * made in this app") is made by the page itself rather than claimed in copy.
 *
 * The illusion only holds if the video lands EXACTLY on the editor's preview
 * canvas, so PREVIEW is measured from the running app rather than eyeballed:
 * canvas.getBoundingClientRect() over the editor window, divided by the
 * viewport. Re-measure and update these four numbers if the editor's layout
 * changes, or the clip will sit slightly off its frame and the whole effect
 * reads as a mistake.
 *
 * Everything animates through `transform` on a single element: the video is
 * laid out at its FINAL position and scaled up to fill the frame at progress 0.
 * Animating width/height instead would relayout every frame, which is what
 * makes this kind of effect stutter.
 */

// Fractions of the editor screenshot occupied by its preview canvas.
const PREVIEW = { x: 0.095, y: 0.0762, w: 0.6079, h: 0.6494 };

// The screenshot's own aspect, so the stage matches it exactly at every width.
const FRAME_ASPECT = 1920 / 1011;

export function DemoInEditor() {
  const sectionRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const frameRef = useRef<HTMLImageElement>(null);
  const clipRef = useRef<HTMLDivElement>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const section = sectionRef.current;
    const stage = stageRef.current;
    const clip = clipRef.current;
    const frame = frameRef.current;
    const video = videoRef.current;
    if (!section || !stage || !clip || !frame || !video) return;

    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    // Start the video only once it is worth paying for, same as the old hero.
    const io = new IntersectionObserver(
      (entries) => {
        if (!entries.some((e) => e.isIntersecting)) return;
        io.disconnect();
        video.preload = 'auto';
        video.load();
        const start = () => {
          setReady(true);
          if (!reduced) video.play().catch(() => {});
        };
        if (video.readyState >= 3) start();
        else video.addEventListener('canplaythrough', start, { once: true });
      },
      { rootMargin: '400px' }
    );
    io.observe(section);

    let raf = 0;
    const apply = () => {
      raf = 0;
      const rect = section.getBoundingClientRect();
      // 0 while the section's top is at the viewport top, 1 once it has been
      // scrolled by its full travel. Clamped so it holds at both ends.
      const travel = Math.max(1, rect.height - window.innerHeight);
      const p = reduced ? 1 : Math.min(1, Math.max(0, -rect.top / travel));
      // Ease so it settles into the editor rather than arriving at constant speed.
      const e = 1 - Math.pow(1 - p, 3);

      const sw = stage.clientWidth;
      const sh = stage.clientHeight;
      if (!sw || !sh) return;

      // Where it starts: filling the stage. The clip is laid out at the
      // editor's preview size, so this is how much bigger the stage is.
      const scale0 = sw / (PREVIEW.w * sw);
      const cx = (PREVIEW.x + PREVIEW.w / 2) * sw;
      const cy = (PREVIEW.y + PREVIEW.h / 2) * sh;
      const dx = (sw / 2 - cx) * (1 - e);
      const dy = (sh / 2 - cy) * (1 - e);
      const s = scale0 + (1 - scale0) * e;

      clip.style.transform = `translate(${dx}px, ${dy}px) scale(${s})`;
      // The editor fades in behind it, and drifts in very slightly so the two
      // do not feel like separate layers.
      frame.style.opacity = String(e);
      frame.style.transform = `scale(${1.04 - 0.04 * e})`;
      // Corners round off as it becomes a card inside the app.
      clip.style.borderRadius = `${6 + 6 * e}px`;
    };

    const onScroll = () => {
      if (!raf) raf = requestAnimationFrame(apply);
    };
    apply();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    return () => {
      io.disconnect();
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
      if (raf) cancelAnimationFrame(raf);
    };
  }, []);

  return (
    // Tall enough to give the transition room; the inner stage sticks while it
    // plays out. 220vh => roughly one viewport of scrolling to complete.
    <div ref={sectionRef} className="relative h-[220vh]">
      <div className="sticky top-0 flex h-screen items-center justify-center px-4">
        <div
          ref={stageRef}
          className="relative w-full max-w-6xl"
          style={{ aspectRatio: String(FRAME_ASPECT) }}
        >
          {/* The editor, behind. Fades in as the clip shrinks into it. */}
          {/* eslint-disable-next-line @next/next/no-img-element -- static asset, fixed size */}
          <img
            ref={frameRef}
            src="/videos/editor-frame.webp"
            alt=""
            width={1920}
            height={1011}
            className="absolute inset-0 h-full w-full rounded-xl opacity-0 shadow-2xl"
          />

          {/* The clip, laid out at its FINAL position and scaled up from there. */}
          <div
            ref={clipRef}
            className="absolute overflow-hidden bg-ink-950 shadow-2xl will-change-transform"
            style={{
              left: `${PREVIEW.x * 100}%`,
              top: `${PREVIEW.y * 100}%`,
              width: `${PREVIEW.w * 100}%`,
              height: `${PREVIEW.h * 100}%`
            }}
          >
            {/* eslint-disable-next-line @next/next/no-img-element -- poster, already sized */}
            <img
              src="/videos/demo-poster.webp"
              alt="A screen recording re-framed in Reframe: a spreadsheet on a warm gradient background with rounded corners, a drop shadow and a webcam bubble."
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
          </div>
        </div>
      </div>
    </div>
  );
}
