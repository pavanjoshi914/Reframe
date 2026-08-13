import { ChevronDownIcon } from './Icons';
import { site } from '@/lib/site';

export const faqs = [
  {
    q: 'Is Reframe really free?',
    a: 'Yes. Reframe is free and open source under the MIT licence. There is no paid tier, no trial, no account and no watermark — the entire source is on GitHub.'
  },
  {
    q: 'Does it do automatic zoom like the expensive tools?',
    a: 'It does. Reframe records your cursor path and clicks while capturing, then suggests zoom keyframes at the busiest moments. You can accept them, edit the scale and easing, or place your own zooms on the timeline.'
  },
  {
    q: 'Can I use it for commercial work?',
    a: 'Yes. The MIT licence lets you use Reframe for client work, product launches, course material or anything else, with no attribution required and nothing stamped on your video.'
  },
  {
    q: 'What can it actually do?',
    a: 'Record a screen, window or region with system audio, microphone and webcam; then add backgrounds, padding, shadow, blur, zooms, trims, speed changes, crops, annotations, a smoothed cursor and a webcam bubble — and export to MP4, GIF or WebM at up to 4K.'
  },
  {
    q: 'Where do my recordings go?',
    a: 'Onto your own disk and nowhere else. Reframe is a desktop app with no backend: no account, no upload, no telemetry. Raw captures live in the app-data folder as scratch files, and exports land wherever you choose to save them.'
  },
  {
    q: 'What permissions does it need?',
    a: 'Screen recording permission on every platform, plus microphone and camera permission if you enable those. On macOS you grant them under System Settings → Privacy & Security; on Linux, Wayland sessions use the standard xdg-desktop-portal screen-cast prompt.'
  },
  {
    q: 'macOS says the app is damaged — what now?',
    a: 'The macOS build is not code-signed yet, so Gatekeeper quarantines it. Right-click the app and choose Open the first time, or run: xattr -cr /Applications/Reframe.app'
  },
  {
    q: 'Does it run on Linux properly?',
    a: 'Linux is the primary development platform, not an afterthought. There are AppImage and .deb builds, cursor capture works on X11 and Wayland, and the .deb declares the ffmpeg and GStreamer dependencies it needs.'
  },
  {
    q: 'How often is it updated?',
    a: `Reframe is actively developed in the open. The app checks GitHub Releases for updates on launch, and you can follow every change on ${site.repoUrl}.`
  }
];

export function FAQ() {
  return (
    <section
      id="faq"
      className="border-t border-ink-100 bg-ink-50/60 py-20 dark:border-white/5 dark:bg-white/[0.02]"
    >
      <div className="mx-auto max-w-3xl px-4 sm:px-6 lg:px-8">
        <h2 className="text-center text-3xl font-bold tracking-tight text-ink-900 dark:text-white sm:text-4xl">
          Frequently asked questions
        </h2>

        <div className="mt-10 space-y-3">
          {faqs.map((f) => (
            <details key={f.q} className="surface group px-5 py-4 [&_summary::-webkit-details-marker]:hidden">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-4 font-semibold text-ink-900 dark:text-white">
                {f.q}
                <ChevronDownIcon className="h-5 w-5 shrink-0 text-ink-400 transition group-open:rotate-180" />
              </summary>
              <p className="mt-3 text-ink-600 dark:text-ink-300">{f.a}</p>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
}
