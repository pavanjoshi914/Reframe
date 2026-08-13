/**
 * A styled illustration of the Reframe editor, used as the hero visual.
 *
 * It is deliberately hand-built rather than a screenshot so it stays crisp at
 * any width and in both themes. To swap in a real screenshot later, drop the
 * image at `public/screenshots/editor.png` and replace the <AppMock /> usage in
 * components/Hero.tsx with a next/image — nothing else depends on this file.
 */

function Dot({ className }: { className: string }) {
  return <span className={`h-2.5 w-2.5 rounded-full ${className}`} />;
}

function SidebarSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <p className="text-[9px] font-semibold uppercase tracking-widest text-white/35">{title}</p>
      {children}
    </div>
  );
}

function Swatch({ className }: { className: string }) {
  return <span className={`h-6 rounded-md ring-1 ring-inset ring-white/10 ${className}`} />;
}

export function AppMock() {
  return (
    <div className="overflow-hidden rounded-xl bg-[#0a0b0e] text-white ring-1 ring-white/10">
      {/* Title bar */}
      <div className="flex h-9 items-center justify-between border-b border-white/5 bg-[#0e0f12] px-3">
        <div className="flex items-center gap-3">
          <div className="flex gap-1.5">
            <Dot className="bg-[#ff5f57]" />
            <Dot className="bg-[#febc2e]" />
            <Dot className="bg-[#28c840]" />
          </div>
          <span className="hidden text-[10px] font-semibold tracking-tight text-white/70 sm:block">Reframe</span>
          <span className="hidden text-[10px] text-white/30 sm:block">demo-2026-08-10.reframe</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="rounded border border-white/10 px-1.5 py-0.5 text-[9px] text-white/50">16:9</span>
          <span className="rounded bg-brand-600 px-2 py-0.5 text-[9px] font-semibold text-white">Export</span>
        </div>
      </div>

      <div className="flex">
        {/* Preview canvas */}
        <div className="flex-1 p-3">
          <div className="relative aspect-[16/10] overflow-hidden rounded-lg bg-gradient-to-br from-brand-500 via-brand-700 to-[#1b1550] p-[7%]">
            {/* The "recorded" window sitting on the chosen background */}
            <div className="h-full w-full overflow-hidden rounded-md bg-[#101218] shadow-2xl shadow-black/50 ring-1 ring-white/10">
              <div className="flex h-4 items-center gap-1 border-b border-white/5 bg-[#171a22] px-2">
                <span className="h-1.5 w-1.5 rounded-full bg-white/25" />
                <span className="h-1.5 w-1.5 rounded-full bg-white/25" />
                <span className="h-1.5 w-1.5 rounded-full bg-white/25" />
                <span className="ml-2 h-1.5 w-16 rounded-full bg-white/10" />
              </div>
              <div className="space-y-1.5 p-2.5">
                <div className="h-1.5 w-2/5 rounded-full bg-brand-400/70" />
                <div className="h-1.5 w-4/5 rounded-full bg-white/12" />
                <div className="h-1.5 w-3/5 rounded-full bg-white/12" />
                <div className="grid grid-cols-3 gap-1.5 pt-1">
                  <div className="h-7 rounded bg-white/[0.06]" />
                  <div className="h-7 rounded bg-white/[0.06]" />
                  <div className="h-7 rounded bg-white/[0.06]" />
                </div>
              </div>
            </div>

            {/* Auto-zoom focus ring following the cursor */}
            <div className="absolute left-[46%] top-[42%] h-[22%] w-[30%] rounded-md border border-white/70 shadow-[0_0_0_9999px_rgba(0,0,0,0.12)]">
              <span className="absolute -top-4 left-0 rounded bg-white/90 px-1 text-[8px] font-semibold text-ink-900">
                Zoom 2.0×
              </span>
            </div>

            {/* Webcam bubble */}
            <div className="absolute bottom-[6%] right-[5%] h-[22%] w-auto aspect-square rounded-full bg-gradient-to-br from-ink-700 to-ink-900 ring-2 ring-white/25" />
          </div>
        </div>

        {/* Right sidebar */}
        <aside className="hidden w-40 shrink-0 space-y-3 border-l border-white/5 bg-[#0e0f12] p-3 sm:block lg:w-48">
          <SidebarSection title="Background">
            <div className="grid grid-cols-4 gap-1.5">
              <Swatch className="bg-gradient-to-br from-brand-400 to-brand-700 ring-2 ring-brand-400" />
              <Swatch className="bg-gradient-to-br from-sky-400 to-indigo-600" />
              <Swatch className="bg-gradient-to-br from-orange-400 to-rose-600" />
              <Swatch className="bg-gradient-to-br from-emerald-400 to-teal-700" />
            </div>
          </SidebarSection>

          <SidebarSection title="Padding">
            <div className="h-1 rounded-full bg-white/10">
              <div className="h-1 w-3/5 rounded-full bg-brand-500" />
            </div>
          </SidebarSection>

          <SidebarSection title="Shadow">
            <div className="h-1 rounded-full bg-white/10">
              <div className="h-1 w-2/5 rounded-full bg-brand-500" />
            </div>
          </SidebarSection>

          <SidebarSection title="Cursor">
            <div className="flex gap-1.5">
              <span className="flex-1 rounded bg-brand-600/25 px-1.5 py-1 text-center text-[9px] text-brand-200">
                Smooth
              </span>
              <span className="flex-1 rounded bg-white/[0.06] px-1.5 py-1 text-center text-[9px] text-white/50">
                Clicks
              </span>
            </div>
          </SidebarSection>

          <SidebarSection title="Webcam">
            <div className="flex items-center justify-between rounded bg-white/[0.06] px-1.5 py-1">
              <span className="text-[9px] text-white/60">Circle</span>
              <span className="h-3 w-6 rounded-full bg-brand-600 p-0.5">
                <span className="ml-auto block h-2 w-2 rounded-full bg-white" />
              </span>
            </div>
          </SidebarSection>
        </aside>
      </div>

      {/* Timeline */}
      <div className="space-y-2 border-t border-white/5 bg-[#0e0f12] p-3">
        <div className="flex items-center gap-2 text-[9px] text-white/40">
          <span className="flex h-5 w-5 items-center justify-center rounded-full bg-white/10 text-white/80">▶</span>
          <span>00:12 / 00:48</span>
          <span className="ml-auto hidden sm:block">Suggest zooms</span>
        </div>
        <div className="relative h-8 overflow-hidden rounded bg-white/[0.04]">
          <div className="absolute inset-y-1 left-[4%] w-[26%] rounded bg-brand-600/70" />
          <div className="absolute inset-y-1 left-[36%] w-[16%] rounded bg-emerald-500/60" />
          <div className="absolute inset-y-1 left-[58%] w-[22%] rounded bg-amber-500/60" />
          <div className="absolute inset-y-0 left-[30%] w-px bg-white" />
        </div>
        <div className="flex gap-3 text-[8px] text-white/40">
          <span className="flex items-center gap-1">
            <span className="h-1.5 w-1.5 rounded-sm bg-brand-600" />
            Zoom
          </span>
          <span className="flex items-center gap-1">
            <span className="h-1.5 w-1.5 rounded-sm bg-emerald-500" />
            Trim
          </span>
          <span className="flex items-center gap-1">
            <span className="h-1.5 w-1.5 rounded-sm bg-amber-500" />
            Annotation
          </span>
        </div>
      </div>
    </div>
  );
}
