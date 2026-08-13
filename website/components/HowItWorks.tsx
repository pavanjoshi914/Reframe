import Image from 'next/image';

const steps = [
  {
    n: '01',
    title: 'Hit record from the HUD',
    body: 'Reframe lives in a small pill toolbar at the top of your screen. Pick a display, window or region, choose your audio and camera, and go. Ctrl+Shift+0 stops the recording from anywhere.'
  },
  {
    n: '02',
    title: 'The editor opens itself',
    body: 'Stop recording and the clip is already loaded — background, padding and shadow applied, cursor path parsed, project file saved. No import step.'
  },
  {
    n: '03',
    title: 'Re-frame it',
    body: 'Suggest zooms, trim the dead air, add annotations, drop in the webcam bubble. Press Z / T / A / S to add a zoom, trim, annotation or speed item right at the playhead.'
  },
  {
    n: '04',
    title: 'Export and ship',
    body: 'Choose MP4, GIF or WebM, pick a resolution up to 4K, and export straight to disk. No watermark, no upload, no sign-in.'
  }
];

export function HowItWorks() {
  return (
    <section id="how-it-works" className="mx-auto max-w-content px-4 py-20 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-2xl text-center">
        <h2 className="text-3xl font-bold tracking-tight text-ink-900 dark:text-white sm:text-4xl">
          Record. Re-frame. Ship.
        </h2>
        <p className="mt-4 text-lg text-ink-600 dark:text-ink-300">
          From a raw capture to a demo you'd put on a landing page, in about four minutes.
        </p>
      </div>

      {/* The recorder itself — a real capture of the HUD window, at 1:1 scale. */}
      <div className="mt-12 flex flex-col items-center">
        <div className="w-full max-w-xl rounded-2xl bg-gradient-to-br from-brand-500/15 to-brand-800/10 p-6 sm:p-10">
          <Image
            src="/screenshots/hud.webp"
            alt="The Reframe HUD: a small pill toolbar with source, system audio, cursor, microphone, webcam and record buttons."
            width={1240}
            height={112}
            className="w-full drop-shadow-2xl"
          />
        </div>
        <p className="mt-4 text-sm text-ink-500 dark:text-ink-400">
          The entire recorder — it floats above your work and stays out of the capture.
        </p>
      </div>

      <ol className="mt-12 grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        {steps.map((s) => (
          <li key={s.n} className="surface relative p-6">
            <span className="text-sm font-bold tracking-widest text-brand-600 dark:text-brand-400">{s.n}</span>
            <h3 className="mt-3 font-semibold text-ink-900 dark:text-white">{s.title}</h3>
            <p className="mt-2 text-sm leading-relaxed text-ink-600 dark:text-ink-300">{s.body}</p>
          </li>
        ))}
      </ol>
    </section>
  );
}
