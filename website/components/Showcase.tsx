'use client';

import { useState } from 'react';
import { AnnotateIcon, BackgroundIcon, ExportIcon, ZoomIcon } from './Icons';

type Tab = {
  id: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  body: string;
  visual: () => React.ReactNode;
};

function Frame({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`relative aspect-[16/9] w-full overflow-hidden rounded-xl p-[6%] ${className}`}>{children}</div>
  );
}

function Window({ children }: { children?: React.ReactNode }) {
  return (
    <div className="h-full w-full overflow-hidden rounded-lg bg-[#101218] shadow-2xl shadow-black/50 ring-1 ring-white/10">
      <div className="flex h-5 items-center gap-1 border-b border-white/5 bg-[#171a22] px-2.5">
        <span className="h-1.5 w-1.5 rounded-full bg-white/25" />
        <span className="h-1.5 w-1.5 rounded-full bg-white/25" />
        <span className="h-1.5 w-1.5 rounded-full bg-white/25" />
      </div>
      <div className="p-3">{children}</div>
    </div>
  );
}

function Lines() {
  return (
    <div className="space-y-2">
      <div className="h-2 w-2/5 rounded-full bg-brand-400/70" />
      <div className="h-2 w-4/5 rounded-full bg-white/10" />
      <div className="h-2 w-3/5 rounded-full bg-white/10" />
      <div className="h-2 w-2/3 rounded-full bg-white/10" />
    </div>
  );
}

const TABS: Tab[] = [
  {
    id: 'zoom',
    label: 'Auto zoom',
    icon: ZoomIcon,
    title: 'Zooms that follow your cursor',
    body: 'Reframe records where your pointer went and where you clicked, then suggests zoom keyframes at the moments that matter. Accept them all, or drag your own on the timeline.',
    visual: () => (
      <Frame className="bg-gradient-to-br from-brand-500 via-brand-700 to-[#1b1550]">
        <Window>
          <Lines />
        </Window>
        <div className="absolute left-[38%] top-[34%] h-[36%] w-[34%] rounded-lg border-2 border-white/80 shadow-[0_0_0_9999px_rgba(0,0,0,0.25)]">
          <span className="absolute -top-6 left-0 rounded bg-white px-1.5 py-0.5 text-[10px] font-semibold text-ink-900">
            2.0× · ease-out
          </span>
        </div>
        <svg viewBox="0 0 24 24" className="absolute left-[60%] top-[58%] h-5 w-5 fill-white drop-shadow">
          <path d="m4 3 7 17 2.5-6.5L20 11 4 3Z" />
        </svg>
      </Frame>
    )
  },
  {
    id: 'background',
    label: 'Backgrounds',
    icon: BackgroundIcon,
    title: 'Wallpapers, gradients and padding',
    body: '20+ bundled wallpapers, solid colours and gradients — plus padding, corner radius, shadow and background blur. Pick 16:9, 9:16, 1:1 or 4:3 and Reframe re-lays the frame for you.',
    visual: () => (
      <Frame className="bg-gradient-to-br from-sky-400 via-indigo-500 to-brand-800">
        <Window>
          <Lines />
        </Window>
        <div className="absolute bottom-3 left-1/2 flex -translate-x-1/2 gap-1.5 rounded-full bg-black/40 p-1.5 backdrop-blur">
          <span className="h-5 w-5 rounded-full bg-gradient-to-br from-brand-400 to-brand-700 ring-2 ring-white" />
          <span className="h-5 w-5 rounded-full bg-gradient-to-br from-sky-400 to-indigo-600" />
          <span className="h-5 w-5 rounded-full bg-gradient-to-br from-orange-400 to-rose-600" />
          <span className="h-5 w-5 rounded-full bg-gradient-to-br from-emerald-400 to-teal-700" />
          <span className="h-5 w-5 rounded-full bg-ink-900" />
        </div>
      </Frame>
    )
  },
  {
    id: 'annotate',
    label: 'Annotations',
    icon: AnnotateIcon,
    title: 'Text, arrows and highlights',
    body: 'Drop annotations on the timeline so they appear exactly when you need them. Choose the font, colour and placement — they fade in and out with the clip.',
    visual: () => (
      <Frame className="bg-gradient-to-br from-orange-400 via-rose-500 to-brand-800">
        <Window>
          <Lines />
        </Window>
        <span className="absolute left-[10%] top-[16%] rounded-lg bg-white px-2.5 py-1 text-[11px] font-bold text-ink-900 shadow-lg">
          Start here 👇
        </span>
        <svg viewBox="0 0 100 60" className="absolute left-[26%] top-[30%] h-[34%] w-[28%]" aria-hidden="true">
          <path
            d="M4 4 C 40 10, 70 26, 90 50"
            fill="none"
            stroke="white"
            strokeWidth="5"
            strokeLinecap="round"
          />
          <path d="M90 50 L 72 46 M90 50 L 84 33" fill="none" stroke="white" strokeWidth="5" strokeLinecap="round" />
        </svg>
      </Frame>
    )
  },
  {
    id: 'export',
    label: 'Export',
    icon: ExportIcon,
    title: 'MP4, GIF or WebM — no watermark',
    body: 'Export up to 4K with hardware encoding on macOS and Windows. Need a loop for a README? Export a GIF. Need a small web clip? WebM. Nothing is stamped on your video.',
    visual: () => (
      <Frame className="bg-gradient-to-br from-emerald-400 via-teal-600 to-brand-900">
        <Window>
          <Lines />
        </Window>
        <div className="absolute inset-x-[12%] bottom-[10%] rounded-xl bg-[#0e0f12]/95 p-3 shadow-2xl ring-1 ring-white/10 backdrop-blur">
          <div className="flex gap-1.5">
            <span className="flex-1 rounded-md bg-brand-600 py-1 text-center text-[10px] font-semibold text-white">
              MP4
            </span>
            <span className="flex-1 rounded-md bg-white/[0.06] py-1 text-center text-[10px] text-white/60">GIF</span>
            <span className="flex-1 rounded-md bg-white/[0.06] py-1 text-center text-[10px] text-white/60">WebM</span>
          </div>
          <div className="mt-2 flex items-center gap-2">
            <div className="h-1 flex-1 rounded-full bg-white/10">
              <div className="h-1 w-2/3 rounded-full bg-brand-500" />
            </div>
            <span className="text-[9px] text-white/50">1080p · 60 fps</span>
          </div>
        </div>
      </Frame>
    )
  }
];

export function Showcase() {
  const [active, setActive] = useState(TABS[0].id);
  const tab = TABS.find((t) => t.id === active) ?? TABS[0];

  return (
    <section id="showcase" className="mx-auto max-w-content px-4 py-20 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-2xl text-center">
        <h2 className="text-3xl font-bold tracking-tight text-ink-900 dark:text-white sm:text-4xl">See it in action</h2>
        <p className="mt-4 text-lg text-ink-600 dark:text-ink-300">
          Everything below happens after you stop recording — the raw capture is never re-encoded until you export.
        </p>
      </div>

      <div className="mt-10 flex flex-wrap justify-center gap-2" role="tablist" aria-label="Reframe features">
        {TABS.map((t) => {
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
              className={`inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-medium transition ${
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

      <div
        role="tabpanel"
        id={`panel-${tab.id}`}
        aria-labelledby={`tab-${tab.id}`}
        className="surface mt-8 grid items-center gap-8 p-6 sm:p-8 lg:grid-cols-[1fr_1.15fr]"
      >
        <div>
          <h3 className="text-2xl font-bold tracking-tight text-ink-900 dark:text-white">{tab.title}</h3>
          <p className="mt-3 text-ink-600 dark:text-ink-300">{tab.body}</p>
        </div>
        <div key={tab.id} className="animate-fade-up">{tab.visual()}</div>
      </div>
    </section>
  );
}
