import { useState } from 'react';
import { ChevronDown, ChevronRight, Download, Upload, X, Loader2, Circle, Square, Squircle, Trash2, ZoomIn, Gauge, Crop } from 'lucide-react';
import { useEditor, type PolishPreset, DEFAULT_CROP_REGION } from './store';
import { runExport } from './export';
import { CropModal } from './CropModal';

const ZOOM_PRESETS = [1.25, 1.5, 1.8, 2.2, 3.5, 5];
const SPEED_PRESETS = [0.25, 0.5, 0.75, 1.25, 1.5, 1.75, 2];

export function Sidebar() {
  const selectedItem = useEditor((s) => s.items.find((it) => it.id === s.selectedItemId) ?? null);
  const showSelection = selectedItem && (selectedItem.kind === 'zoom' || selectedItem.kind === 'speed');

  return (
    <div className="flex h-full w-[320px] flex-col overflow-hidden rounded-xl border border-white/5 bg-[#0e0f12]">
      <div className="flex-1 overflow-y-auto">
        {showSelection && (
          <Section title="Selection" defaultOpen>
            <SelectionSection />
          </Section>
        )}
        <Section title="Composition" defaultOpen>
          <CompositionSection />
        </Section>
        <Section title="Style" defaultOpen>
          <StyleSection />
        </Section>
        <Section title="Video Effects" defaultOpen>
          <VideoEffectsSection />
        </Section>
      </div>
      <ExportSection />
    </div>
  );
}

function SelectionSection() {
  const item = useEditor((s) => s.items.find((it) => it.id === s.selectedItemId) ?? null);
  const updateItem = useEditor((s) => s.updateItem);
  const removeItem = useEditor((s) => s.removeItem);
  const selectItem = useEditor((s) => s.selectItem);

  if (!item) return null;

  if (item.kind === 'zoom') {
    const zoom = item.zoomLevel ?? 1.5;
    return (
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <span className="flex items-center gap-1.5 text-xs text-white/70">
            <ZoomIn size={12} /> Zoom Level
          </span>
          <span className="rounded bg-emerald-500/15 px-1.5 py-0.5 font-mono text-[11px] text-emerald-300">
            {zoom.toFixed(2)}×
          </span>
        </div>
        <PresetGrid
          presets={ZOOM_PRESETS}
          active={zoom}
          fmt={(v) => `${v}×`}
          onPick={(v) => updateItem(item.id, { zoomLevel: v })}
        />
        <NumberInput
          label="Custom"
          value={zoom}
          min={1}
          max={10}
          step={0.05}
          suffix="×"
          onChange={(v) => updateItem(item.id, { zoomLevel: v })}
        />
        <div className="grid grid-cols-2 gap-2">
          <NumberInput
            label="Focus X"
            value={item.zoomTargetX ?? 0.5}
            min={0}
            max={1}
            step={0.01}
            onChange={(v) => updateItem(item.id, { zoomTargetX: v })}
          />
          <NumberInput
            label="Focus Y"
            value={item.zoomTargetY ?? 0.5}
            min={0}
            max={1}
            step={0.01}
            onChange={(v) => updateItem(item.id, { zoomTargetY: v })}
          />
        </div>
        <p className="text-[11px] text-white/40">Tip: drag the green crosshair on the preview to set focus.</p>
        <DeleteBtn onClick={() => { removeItem(item.id); selectItem(null); }} label="Delete Zoom" />
      </div>
    );
  }

  if (item.kind === 'speed') {
    const rate = item.speed ?? 1.5;
    return (
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <span className="flex items-center gap-1.5 text-xs text-white/70">
            <Gauge size={12} /> Playback Speed
          </span>
          <span className="rounded bg-sky-500/15 px-1.5 py-0.5 font-mono text-[11px] text-sky-300">
            {rate.toFixed(2)}×
          </span>
        </div>
        <PresetGrid
          presets={SPEED_PRESETS}
          active={rate}
          fmt={(v) => `${v}×`}
          onPick={(v) => updateItem(item.id, { speed: v })}
        />
        <NumberInput
          label="Custom"
          value={rate}
          min={0.1}
          max={10}
          step={0.05}
          suffix="×"
          onChange={(v) => updateItem(item.id, { speed: v })}
        />
        <DeleteBtn onClick={() => { removeItem(item.id); selectItem(null); }} label="Delete Speed Region" />
      </div>
    );
  }

  return null;
}

function PresetGrid({
  presets,
  active,
  fmt,
  onPick
}: {
  presets: number[];
  active: number;
  fmt: (v: number) => string;
  onPick: (v: number) => void;
}) {
  return (
    <div className="grid grid-cols-3 gap-1.5">
      {presets.map((p) => {
        const isActive = Math.abs(p - active) < 0.001;
        return (
          <button
            key={p}
            onClick={() => onPick(p)}
            className={
              'rounded-md border px-2 py-1.5 text-xs font-medium transition-colors ' +
              (isActive
                ? 'border-emerald-400 bg-emerald-500/15 text-emerald-200'
                : 'border-white/10 bg-black/30 text-white/70 hover:bg-white/5')
            }
          >
            {fmt(p)}
          </button>
        );
      })}
    </div>
  );
}

function NumberInput({
  label,
  value,
  min,
  max,
  step,
  suffix,
  onChange
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  suffix?: string;
  onChange: (v: number) => void;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-[11px] text-white/60">{label}</span>
      <div className="flex items-center gap-1.5">
        <input
          type="number"
          value={Number(value.toFixed(2))}
          min={min}
          max={max}
          step={step}
          onChange={(e) => {
            const next = Number(e.target.value);
            if (Number.isFinite(next)) onChange(Math.max(min, Math.min(max, next)));
          }}
          className="w-full rounded-md border border-white/10 bg-black/30 px-2 py-1 text-sm text-white/90 focus:border-emerald-400/60 focus:outline-none"
        />
        {suffix && <span className="text-xs text-white/40">{suffix}</span>}
      </div>
    </label>
  );
}

function DeleteBtn({ onClick, label }: { onClick: () => void; label: string }) {
  return (
    <button
      onClick={onClick}
      className="flex w-full items-center justify-center gap-1.5 rounded-md border border-rose-500/30 bg-rose-500/10 px-3 py-1.5 text-xs font-medium text-rose-300 hover:bg-rose-500/20"
    >
      <Trash2 size={12} /> {label}
    </button>
  );
}

function Section({ title, defaultOpen, children }: { title: string; defaultOpen?: boolean; children: React.ReactNode }) {
  const [open, setOpen] = useState(!!defaultOpen);
  return (
    <div className="border-b border-white/5">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-white/60 hover:text-white"
      >
        {title}
        {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
      </button>
      {open && <div className="px-4 pb-4">{children}</div>}
    </div>
  );
}

function CompositionSection() {
  const layoutPreset = useEditor((s) => s.layoutPreset);
  const setLayoutPreset = useEditor((s) => s.setLayoutPreset);
  const webcam = useEditor((s) => s.webcam);
  const setWebcam = useEditor((s) => s.setWebcam);
  const background = useEditor((s) => s.background);
  const setBackground = useEditor((s) => s.setBackground);

  async function handleUploadImage() {
    const res = await window.api.pickImageFile();
    if (res) setBackground({ mode: 'image', value: res.dataUrl });
  }

  return (
    <div className="space-y-4">
      <div>
        <Label>Layout</Label>
        <select
          value={layoutPreset}
          onChange={(e) => setLayoutPreset(e.target.value as any)}
          className="w-full rounded-md border border-white/10 bg-black/30 px-2 py-1.5 text-sm"
        >
          <option value="pip-bottom-right">PiP — Bottom Right</option>
          <option value="pip-bottom-left">PiP — Bottom Left</option>
          <option value="pip-top-right">PiP — Top Right</option>
          <option value="pip-top-left">PiP — Top Left</option>
          <option value="side-by-side">Side by Side</option>
        </select>
      </div>

      <div>
        <Label>Webcam</Label>
        <ToggleRow label="Enable" checked={webcam.enabled} onChange={(v) => setWebcam({ enabled: v })} />
        <RangeRow label="Size" value={webcam.size} min={0.08} max={0.6} step={0.01} onChange={(v) => setWebcam({ size: v })} fmt={(v) => `${Math.round(v * 100)}%`} />
        <div className="mt-2">
          <div className="mb-1 text-xs text-white/70">Shape</div>
          <div className="grid grid-cols-3 gap-1.5">
            <ShapeBtn active={webcam.shape === 'circle'} onClick={() => setWebcam({ shape: 'circle' })} label="Circle">
              <Circle size={14} />
            </ShapeBtn>
            <ShapeBtn active={webcam.shape === 'rounded'} onClick={() => setWebcam({ shape: 'rounded' })} label="Rounded">
              <Squircle size={14} />
            </ShapeBtn>
            <ShapeBtn active={webcam.shape === 'square'} onClick={() => setWebcam({ shape: 'square' })} label="Square">
              <Square size={14} />
            </ShapeBtn>
          </div>
        </div>
      </div>

      <div>
        <Label>Background</Label>
        <div className="mb-2 flex gap-1">
          <BgTab active={background.mode === 'image'} onClick={() => setBackground({ mode: 'image', value: background.mode === 'image' ? background.value : '' })}>Image</BgTab>
          <BgTab active={background.mode === 'color'} onClick={() => setBackground({ mode: 'color', value: background.mode === 'color' ? background.value : '#1a1d23' })}>Color</BgTab>
          <BgTab active={background.mode === 'gradient'} onClick={() => setBackground({ mode: 'gradient', value: background.mode === 'gradient' ? background.value : 'linear-gradient(135deg,#fb923c,#ec4899)' })}>Gradient</BgTab>
        </div>
        {background.mode === 'color' && (
          <input
            type="color"
            value={background.value}
            onChange={(e) => setBackground({ mode: 'color', value: e.target.value })}
            className="h-8 w-full rounded border border-white/10 bg-transparent"
            aria-label="Background color"
          />
        )}
        {background.mode === 'gradient' && (
          <div className="grid grid-cols-4 gap-1.5">
            {GRADIENTS.map((g, i) => (
              <button
                key={g}
                aria-label={`Gradient ${i + 1}`}
                title={`Gradient ${i + 1}`}
                onClick={() => setBackground({ mode: 'gradient', value: g })}
                className={
                  'aspect-square rounded ' + (background.value === g ? 'ring-2 ring-emerald-400' : 'ring-1 ring-white/10')
                }
                style={{ backgroundImage: g }}
              />
            ))}
          </div>
        )}
        {background.mode === 'image' && (
          <div className="space-y-2">
            <button
              onClick={handleUploadImage}
              className="flex w-full items-center justify-center gap-2 rounded-md border border-white/10 bg-black/30 px-3 py-2 text-sm hover:bg-white/5"
            >
              <Upload size={14} /> {background.value ? 'Replace Image' : 'Upload Custom'}
            </button>
            {background.value && (
              <div className="relative h-20 w-full overflow-hidden rounded border border-white/10">
                <img src={background.value} alt="background preview" className="h-full w-full object-cover" />
                <button
                  onClick={() => setBackground({ mode: 'image', value: '' })}
                  className="absolute right-1 top-1 rounded bg-black/60 p-0.5 text-white/80 hover:bg-black/80"
                  title="Clear image"
                  aria-label="Clear image"
                >
                  <X size={12} />
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function StyleSection() {
  const polish = useEditor((s) => s.polish);
  const setPolish = useEditor((s) => s.setPolish);

  return (
    <div className="space-y-4">
      <div>
        <Label>Polish Preset</Label>
        <div className="grid grid-cols-3 gap-1.5">
          {(['subtle', 'soft', 'dramatic'] as PolishPreset[]).map((p) => (
            <button
              key={p}
              onClick={() => setPolish(p)}
              className={
                'rounded-md px-2 py-1.5 text-xs font-medium capitalize ' +
                (polish === p ? 'bg-emerald-500 text-black' : 'bg-white/5 text-white/70 hover:bg-white/10')
              }
            >
              {p}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

// Video Effects — was previously buried behind a Style → Advanced toggle.
// Promoted to its own section with a 2-col slider grid for parity with the
// openscreen reference, plus a Crop Video entry point.
function VideoEffectsSection() {
  const effects = useEditor((s) => s.effects);
  const setEffect = useEditor((s) => s.setEffect);
  const cropRegion = useEditor((s) => s.cropRegion);
  const setCropRegion = useEditor((s) => s.setCropRegion);
  const fileUrl = useEditor((s) => s.fileUrl);
  const [cropOpen, setCropOpen] = useState(false);

  const cropActive =
    cropRegion.x !== 0 || cropRegion.y !== 0 || cropRegion.width !== 1 || cropRegion.height !== 1;

  return (
    <div className="space-y-3">
      <ToggleRow label="Blur BG" checked={effects.blurBg} onChange={(v) => setEffect('blurBg', v)} />
      <div className="grid grid-cols-2 gap-x-3 gap-y-1">
        <RangeRow label="Shadow" value={effects.shadowPct} min={0} max={100} step={1} onChange={(v) => setEffect('shadowPct', v)} fmt={(v) => `${v}%`} />
        <RangeRow label="Roundness" value={effects.roundnessPx} min={0} max={40} step={1} onChange={(v) => setEffect('roundnessPx', v)} fmt={(v) => `${v}px`} />
        <RangeRow label="Padding" value={effects.paddingPct} min={0} max={100} step={1} onChange={(v) => setEffect('paddingPct', v)} fmt={(v) => `${v}%`} />
      </div>
      <div className="flex gap-2">
        <button
          onClick={() => setCropOpen(true)}
          disabled={!fileUrl}
          className="flex flex-1 items-center justify-center gap-2 rounded-md border border-white/10 bg-black/30 px-3 py-2 text-sm hover:bg-white/5 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          <Crop size={14} /> {cropActive ? 'Edit Crop' : 'Crop Video'}
        </button>
        {cropActive && (
          <button
            onClick={() => setCropRegion(DEFAULT_CROP_REGION)}
            className="rounded-md border border-white/10 bg-white/5 px-2 text-xs text-white/70 hover:bg-white/10"
            title="Clear crop"
          >
            Reset
          </button>
        )}
      </div>
      {cropOpen && <CropModal onClose={() => setCropOpen(false)} />}
    </div>
  );
}

function ExportSection() {
  const fmt = useEditor((s) => s.exportFormat);
  const setFmt = useEditor((s) => s.setExportFormat);
  const q = useEditor((s) => s.exportQuality);
  const setQ = useEditor((s) => s.setExportQuality);
  const fileUrl = useEditor((s) => s.fileUrl);
  const [busy, setBusy] = useState<null | { phase: string; pct: number }>(null);

  async function handleExport() {
    if (!fileUrl) {
      alert('No recording loaded.');
      return;
    }
    if (busy) return;
    try {
      setBusy({ phase: 'Preparing…', pct: 0 });
      await runExport({
        onProgress: (phase, pct) => setBusy({ phase, pct })
      });
    } catch (err) {
      console.error('export failed', err);
      alert('Export failed: ' + (err as Error).message);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="border-t border-white/5 bg-black/30 p-4">
      <Label>Format</Label>
      <div className="mb-3 grid grid-cols-2 gap-1.5">
        <ChipBtn active={fmt === 'mp4'} onClick={() => setFmt('mp4')}>MP4</ChipBtn>
        <ChipBtn active={fmt === 'gif'} onClick={() => setFmt('gif')}>GIF</ChipBtn>
      </div>
      <Label>Quality</Label>
      <div className="mb-4 grid grid-cols-3 gap-1.5">
        <ChipBtn active={q === 'low'} onClick={() => setQ('low')}>Low</ChipBtn>
        <ChipBtn active={q === 'medium'} onClick={() => setQ('medium')}>Medium</ChipBtn>
        <ChipBtn active={q === 'high'} onClick={() => setQ('high')}>High</ChipBtn>
      </div>
      <button
        onClick={handleExport}
        disabled={!!busy || !fileUrl}
        className="flex w-full items-center justify-center gap-2 rounded-md bg-emerald-500 px-4 py-2.5 text-sm font-semibold text-black hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {busy ? <Loader2 size={16} className="animate-spin" /> : <Download size={16} />}
        {busy ? `${busy.phase} ${Math.round(busy.pct)}%` : 'Export Video'}
      </button>
    </div>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return <div className="mb-1.5 text-[11px] font-medium uppercase tracking-wider text-white/50">{children}</div>;
}

function ToggleRow({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex items-center justify-between py-1 text-sm">
      <span className="text-white/80">{label}</span>
      <button
        onClick={() => onChange(!checked)}
        aria-label={`${label} toggle`}
        aria-pressed={checked}
        title={`Toggle ${label}`}
        className={'h-5 w-9 rounded-full transition ' + (checked ? 'bg-emerald-500' : 'bg-white/10')}
      >
        <span className={'block h-4 w-4 rounded-full bg-white transition ' + (checked ? 'translate-x-4' : 'translate-x-0.5')} />
      </button>
    </label>
  );
}

function RangeRow({
  label,
  value,
  min,
  max,
  step,
  onChange,
  fmt
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
  fmt?: (v: number) => string;
}) {
  return (
    <div className="py-1">
      <div className="mb-1 flex items-center justify-between text-xs">
        <span className="text-white/70">{label}</span>
        <span className="font-mono text-white/40">{fmt ? fmt(value) : value}</span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full accent-emerald-500"
      />
    </div>
  );
}

function ChipBtn({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={
        'rounded-md px-2 py-1.5 text-xs font-medium ' +
        (active ? 'bg-emerald-500 text-black' : 'bg-white/5 text-white/70 hover:bg-white/10')
      }
    >
      {children}
    </button>
  );
}

function ShapeBtn({
  active,
  onClick,
  label,
  children
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      title={label}
      aria-label={label}
      aria-pressed={active}
      className={
        'flex items-center justify-center gap-1 rounded-md px-2 py-1.5 text-[11px] font-medium ' +
        (active ? 'bg-emerald-500 text-black' : 'bg-white/5 text-white/70 hover:bg-white/10')
      }
    >
      {children}
      <span>{label}</span>
    </button>
  );
}

function BgTab({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={
        'flex-1 rounded-md px-2 py-1 text-xs ' +
        (active ? 'bg-emerald-500 text-black' : 'bg-white/5 text-white/70 hover:bg-white/10')
      }
    >
      {children}
    </button>
  );
}

const GRADIENTS = [
  'linear-gradient(135deg,#fb923c,#ec4899)',
  'linear-gradient(135deg,#3b82f6,#8b5cf6)',
  'linear-gradient(135deg,#10b981,#3b82f6)',
  'linear-gradient(135deg,#f59e0b,#ef4444)',
  'linear-gradient(135deg,#1e3a8a,#0c4a6e)',
  'linear-gradient(135deg,#0f172a,#334155)',
  'linear-gradient(135deg,#fde68a,#fca5a5)',
  'linear-gradient(135deg,#a78bfa,#f472b6)'
];
