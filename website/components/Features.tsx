import {
  AnnotateIcon,
  BackgroundIcon,
  BoltIcon,
  CursorIcon,
  ExportIcon,
  GlobeIcon,
  RecordIcon,
  ScissorsIcon,
  ShieldIcon,
  WebcamIcon,
  ZoomIcon
} from './Icons';

const features = [
  {
    icon: RecordIcon,
    title: 'Screen recording',
    body: 'Capture a full display, a single window or a custom region — with system audio, microphone and webcam recorded alongside.'
  },
  {
    icon: ZoomIcon,
    title: 'Auto zoom',
    body: 'Cursor movement and clicks are tracked while you record, so Reframe can suggest zoom keyframes at the moments that matter.'
  },
  {
    icon: BackgroundIcon,
    title: 'Beautiful backgrounds',
    body: '20+ wallpapers, gradients and solid colours, plus padding, corner radius, shadow, blur and 16:9 / 9:16 / 1:1 / 4:3 layouts.'
  },
  {
    icon: AnnotateIcon,
    title: 'Annotations',
    body: 'Add text and callouts on the timeline with your choice of font, size, colour and position — timed to the frame.'
  },
  {
    icon: ScissorsIcon,
    title: 'Trim, speed & crop',
    body: 'Cut the dead air, speed up the boring parts, crop the frame. Every edit lives on its own timeline lane and is fully undoable.'
  },
  {
    icon: CursorIcon,
    title: 'Cursor you can style',
    body: 'Swap the jittery OS pointer for System, Arrow, Ring or Dot, then tune its size, colour and smoothing — with click highlights on top.'
  },
  {
    icon: ZoomIcon,
    title: 'Spotlight, magnify & blur',
    body: 'Dim everything but the region that matters, magnify a detail in place, or blur a chunk of the frame to hide what should not ship.'
  },
  {
    icon: WebcamIcon,
    title: 'Webcam & layouts',
    body: 'Record your camera as its own track, then place it as a circle, square or rectangle — picture-in-picture, side by side, or camera only.'
  },
  {
    icon: ExportIcon,
    title: 'Export options',
    body: 'MP4, GIF or WebM at up to 4K — GPU-accelerated on macOS and Windows. No watermark, ever.'
  },
  {
    icon: BoltIcon,
    title: 'Auto-save projects',
    body: 'Every recording gets a project file from edit #0, saved as you work. Reopen it later and pick up exactly where you left off.'
  },
  {
    icon: ShieldIcon,
    title: 'Private by design',
    body: 'Everything runs on your machine. No account, no upload, no telemetry — your recordings never leave your disk.'
  },
  {
    icon: GlobeIcon,
    title: '20 languages',
    body: 'The whole interface ships translated, from English and Spanish to Hindi, Japanese, Arabic and Ukrainian.'
  },
  {
    icon: RecordIcon,
    title: 'Truly cross-platform',
    body: 'One codebase, three first-class targets: Linux (AppImage + .deb), Windows (.exe) and macOS (.dmg).'
  }
];

export function Features() {
  return (
    <section id="features" className="border-y border-ink-100 bg-ink-50/60 py-20 dark:border-white/5 dark:bg-white/[0.02]">
      <div className="mx-auto max-w-content px-4 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-2xl text-center">
          <h2 className="text-3xl font-bold tracking-tight text-ink-900 dark:text-white sm:text-4xl">
            Everything you need
          </h2>
          <p className="mt-4 text-lg text-ink-600 dark:text-ink-300">
            A recorder and an editor in one app — nothing to stitch together, nothing to pay for.
          </p>
        </div>

        <div className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {features.map((f) => {
            const Icon = f.icon;
            return (
              <div key={f.title} className="surface p-6 transition hover:border-brand-300 dark:hover:border-brand-500/40">
                <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand-600/10 text-brand-600 dark:bg-brand-500/15 dark:text-brand-300">
                  <Icon className="h-5 w-5" />
                </span>
                <h3 className="mt-4 font-semibold text-ink-900 dark:text-white">{f.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-ink-600 dark:text-ink-300">{f.body}</p>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
