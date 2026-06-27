import { useState } from 'react';
import { ChevronDown, ChevronRight, Download, Upload, X, Loader2, Circle, Square, RectangleHorizontal, Trash2, ZoomIn, Gauge, Crop, Bold, Italic, AlignLeft, AlignCenter, AlignRight, Type } from 'lucide-react';
import { useEditor, type PolishPreset, DEFAULT_CROP_REGION, ANNOTATION_DEFAULTS, type LaneItem } from './store';
import { runExport } from './export';
import { CropModal } from './CropModal';

const ZOOM_PRESETS = [1.25, 1.5, 1.8, 2.2, 3.5, 5];
const SPEED_PRESETS = [0.25, 0.5, 0.75, 1.25, 1.5, 2, 3, 5];

export function Sidebar() {
  const selectedItem = useEditor((s) => s.items.find((it) => it.id === s.selectedItemId) ?? null);
  const showSelection = selectedItem && (
    selectedItem.kind === 'zoom' ||
    selectedItem.kind === 'speed' ||
    selectedItem.kind === 'annotation'
  );

  return (
    <div className="flex h-full w-[380px] flex-col overflow-hidden rounded-xl border border-white/5 bg-[#0e0f12]">
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

  if (item.kind === 'annotation') {
    return <AnnotationEditor item={item} />;
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

const ANNOTATION_FONT_FAMILIES = [
  { label: 'System Sans', value: 'system-ui, sans-serif' },
  { label: 'Inter', value: 'Inter, system-ui, sans-serif' },
  { label: 'Serif', value: 'Georgia, "Times New Roman", serif' },
  { label: 'Mono', value: 'ui-monospace, SFMono-Regular, Menlo, monospace' },
  { label: 'Rounded', value: '"SF Pro Rounded", "Avenir Next", "Trebuchet MS", sans-serif' }
];

const ANNOTATION_BG_PRESETS: { label: string; value: string | null }[] = [
  { label: 'Dark', value: 'rgba(0,0,0,0.75)' },
  { label: 'Light', value: 'rgba(255,255,255,0.9)' },
  { label: 'Brand', value: 'rgba(16,185,129,0.85)' },
  { label: 'Warning', value: 'rgba(234,88,12,0.85)' },
  { label: 'None', value: null }
];

function AnnotationEditor({ item }: { item: LaneItem }) {
  const updateItem = useEditor((s) => s.updateItem);
  const removeItem = useEditor((s) => s.removeItem);
  const selectItem = useEditor((s) => s.selectItem);

  const set = <K extends keyof LaneItem>(patch: Partial<Pick<LaneItem, K>>) =>
    updateItem(item.id, patch);

  const text = item.text ?? '';
  const fontFamily = item.fontFamily ?? ANNOTATION_DEFAULTS.fontFamily;
  const fontSize = item.fontSize ?? ANNOTATION_DEFAULTS.fontSize;
  const bold = item.bold ?? ANNOTATION_DEFAULTS.bold;
  const italic = item.italic ?? ANNOTATION_DEFAULTS.italic;
  const textColor = item.textColor ?? ANNOTATION_DEFAULTS.textColor;
  const backgroundColor = item.backgroundColor === null ? null : (item.backgroundColor ?? ANNOTATION_DEFAULTS.backgroundColor);
  const textAlign = item.textAlign ?? ANNOTATION_DEFAULTS.textAlign;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <span className="flex items-center gap-1.5 text-xs text-white/70">
          <Type size={12} /> Annotation
        </span>
        <span className="rounded bg-amber-500/15 px-1.5 py-0.5 font-mono text-[11px] text-amber-300">
          {((item.endMs - item.startMs) / 1000).toFixed(1)}s
        </span>
      </div>

      <textarea
        value={text}
        onChange={(e) => set({ text: e.target.value })}
        placeholder="Enter text…"
        rows={3}
        className="w-full resize-none rounded border border-white/10 bg-black/30 px-2 py-1.5 text-sm text-white/90 placeholder:text-white/30 focus:border-emerald-400/40 focus:outline-none"
      />

      <div className="grid grid-cols-2 gap-2">
        <div>
          <Label>Font</Label>
          <select
            value={fontFamily}
            onChange={(e) => set({ fontFamily: e.target.value })}
            className="h-7 w-full rounded border border-white/10 bg-black/30 px-1.5 text-xs text-white/80 focus:outline-none"
          >
            {ANNOTATION_FONT_FAMILIES.map((f) => (
              <option key={f.value} value={f.value} style={{ fontFamily: f.value }}>
                {f.label}
              </option>
            ))}
          </select>
        </div>
        <NumberInput
          label="Size"
          value={fontSize}
          min={12}
          max={200}
          step={1}
          suffix="px"
          onChange={(v) => set({ fontSize: v })}
        />
      </div>

      <div className="flex items-center gap-1">
        <IconToggleBtn active={bold} onClick={() => set({ bold: !bold })} title="Bold">
          <Bold size={13} />
        </IconToggleBtn>
        <IconToggleBtn active={italic} onClick={() => set({ italic: !italic })} title="Italic">
          <Italic size={13} />
        </IconToggleBtn>
        <span className="mx-1 h-4 w-px bg-white/10" />
        <IconToggleBtn active={textAlign === 'left'} onClick={() => set({ textAlign: 'left' })} title="Align left">
          <AlignLeft size={13} />
        </IconToggleBtn>
        <IconToggleBtn active={textAlign === 'center'} onClick={() => set({ textAlign: 'center' })} title="Align centre">
          <AlignCenter size={13} />
        </IconToggleBtn>
        <IconToggleBtn active={textAlign === 'right'} onClick={() => set({ textAlign: 'right' })} title="Align right">
          <AlignRight size={13} />
        </IconToggleBtn>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div>
          <Label>Text colour</Label>
          <ColorPickRow
            value={textColor}
            onChange={(v) => set({ textColor: v })}
          />
        </div>
        <div>
          <Label>Background</Label>
          <div className="flex flex-wrap gap-1">
            {ANNOTATION_BG_PRESETS.map((p) => {
              const active = (backgroundColor ?? null) === p.value;
              return (
                <button
                  key={p.label}
                  onClick={() => set({ backgroundColor: p.value })}
                  title={p.label}
                  className={
                    'h-6 w-6 rounded ring-1 transition ' +
                    (active ? 'ring-emerald-400 ring-2' : 'ring-white/15 hover:ring-white/30')
                  }
                  style={{
                    background: p.value ?? 'repeating-conic-gradient(rgba(255,255,255,0.1) 0deg 90deg, rgba(255,255,255,0.02) 90deg 180deg) 0 0 / 8px 8px'
                  }}
                />
              );
            })}
          </div>
        </div>
      </div>

      <p className="text-[11px] text-white/40">Tip: drag the annotation on the preview to reposition it.</p>
      <DeleteBtn onClick={() => { removeItem(item.id); selectItem(null); }} label="Delete Annotation" />
    </div>
  );
}

function IconToggleBtn({
  active,
  onClick,
  title,
  children
}: {
  active: boolean;
  onClick: () => void;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      className={
        'flex h-7 w-7 items-center justify-center rounded border transition ' +
        (active
          ? 'border-emerald-400/50 bg-emerald-500/15 text-emerald-300'
          : 'border-white/10 bg-black/20 text-white/70 hover:bg-white/5')
      }
    >
      {children}
    </button>
  );
}

function ColorPickRow({
  value,
  onChange
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="flex items-center gap-1.5">
      <input
        type="color"
        value={value.startsWith('#') ? value : '#ffffff'}
        onChange={(e) => onChange(e.target.value)}
        className="h-7 w-7 shrink-0 cursor-pointer rounded border border-white/10 bg-transparent"
        aria-label="Pick colour"
      />
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        spellCheck={false}
        className="h-7 flex-1 rounded border border-white/10 bg-black/30 px-1.5 font-mono text-[11px] text-white/80 focus:border-emerald-400/40 focus:outline-none"
      />
    </div>
  );
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
            <ShapeBtn active={webcam.shape === 'rectangle'} onClick={() => setWebcam({ shape: 'rectangle' })} label="Rectangle">
              <RectangleHorizontal size={14} />
            </ShapeBtn>
            <ShapeBtn active={webcam.shape === 'square'} onClick={() => setWebcam({ shape: 'square' })} label="Square">
              <Square size={14} />
            </ShapeBtn>
            <ShapeBtn active={webcam.shape === 'circle'} onClick={() => setWebcam({ shape: 'circle' })} label="Circle">
              <Circle size={14} />
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
          <div className="space-y-2">
            {/* Live preview tile — large, shows the current hex prominently */}
            <div
              className="flex h-16 w-full items-center justify-center rounded-md border border-white/10 font-mono text-xs"
              style={{
                backgroundColor: background.value,
                color: pickReadableTextColor(background.value)
              }}
            >
              {background.value.toUpperCase()}
            </div>
            {/* Swatch grid */}
            <div className="grid grid-cols-8 gap-1.5">
              {COLOR_SWATCHES.map((c) => (
                <button
                  key={c}
                  aria-label={`Color ${c}`}
                  title={c}
                  onClick={() => setBackground({ mode: 'color', value: c })}
                  className={
                    'aspect-square rounded transition ' +
                    (background.value.toLowerCase() === c.toLowerCase()
                      ? 'ring-2 ring-emerald-400'
                      : 'ring-1 ring-white/10 hover:ring-white/30')
                  }
                  style={{ backgroundColor: c }}
                />
              ))}
            </div>
            {/* Hex input + native picker */}
            <div className="flex items-center gap-2">
              <input
                type="color"
                value={background.value}
                onChange={(e) => setBackground({ mode: 'color', value: e.target.value })}
                className="h-8 w-8 shrink-0 cursor-pointer rounded border border-white/10 bg-transparent"
                aria-label="Pick color"
              />
              <input
                type="text"
                value={background.value}
                onChange={(e) => {
                  const v = e.target.value;
                  if (/^#?[0-9a-f]{0,8}$/i.test(v)) {
                    setBackground({ mode: 'color', value: v.startsWith('#') ? v : '#' + v });
                  }
                }}
                placeholder="#RRGGBB"
                className="h-8 flex-1 rounded border border-white/10 bg-black/30 px-2 font-mono text-xs uppercase outline-none focus:border-emerald-400/50"
              />
            </div>
          </div>
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
              <Upload size={14} /> Upload Custom
            </button>
            <div className="grid grid-cols-4 gap-1.5">
              {WALLPAPER_URLS.map((url, i) => (
                <button
                  key={url}
                  aria-label={`Wallpaper ${i + 1}`}
                  title={`Wallpaper ${i + 1}`}
                  onClick={() => setBackground({ mode: 'image', value: url })}
                  className={
                    'aspect-square overflow-hidden rounded transition ' +
                    (background.value === url
                      ? 'ring-2 ring-emerald-400'
                      : 'ring-1 ring-white/10 hover:ring-white/30')
                  }
                >
                  <img src={url} alt="" className="h-full w-full object-cover" loading="lazy" />
                </button>
              ))}
            </div>
            {background.value && !WALLPAPER_URLS.includes(background.value) && (
              <div className="relative h-20 w-full overflow-hidden rounded border border-white/10">
                <img src={background.value} alt="custom background preview" className="h-full w-full object-cover" />
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
        <RangeRow label="Motion Blur" value={Math.round(effects.motionBlur * 100)} min={0} max={80} step={1} onChange={(v) => setEffect('motionBlur', v / 100)} fmt={(v) => `${v}%`} />
        <RangeRow label="Spotlight" value={Math.round((effects.cursorSpotlight ?? 0) * 100)} min={0} max={100} step={1} onChange={(v) => setEffect('cursorSpotlight', v / 100)} fmt={(v) => `${v}%`} />
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
      <div className="mb-3 grid grid-cols-3 gap-1.5">
        <ChipBtn active={fmt === 'mp4'} onClick={() => setFmt('mp4')}>MP4</ChipBtn>
        <ChipBtn active={fmt === 'webm'} onClick={() => setFmt('webm')}>WebM</ChipBtn>
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

// Curated from uigradients.com and similar free CSS gradient libraries — these
// are public CSS strings, not bundled images, so no licensing or asset-size
// considerations. Mix of warm/cool/duotone/photographic-feel and a few moody
// darks so dark UI screenshots have a tonal home.
const GRADIENTS = [
  // Warm sunsets
  'linear-gradient(135deg,#fb923c,#ec4899)',
  'linear-gradient(111.6deg,rgba(114,167,232,1) 9.4%,rgba(253,129,82,1) 43.9%,rgba(253,129,82,1) 54.8%,rgba(249,202,86,1) 86.3%)',
  'linear-gradient(135deg,#f59e0b,#ef4444)',
  'linear-gradient(107.7deg,rgba(235,230,44,0.7) 8.4%,rgba(252,152,15,1) 90.3%)',
  'linear-gradient(to right,#fa709a,#fee140)',
  'linear-gradient(to right,#ff8177,#ff8c7f 21%,#f99185 52%,#cf556c 78%,#b12a5b)',
  'linear-gradient(45deg,#ff9a9e,#fad0c4 99%,#fad0c4)',
  // Cool blues / purples
  'linear-gradient(135deg,#3b82f6,#8b5cf6)',
  'linear-gradient(135deg,#10b981,#3b82f6)',
  'linear-gradient(120deg,#84fab0,#8fd3f4)',
  'linear-gradient(to right,#4facfe,#00f2fe)',
  'linear-gradient(to top,#30cfd0,#330867)',
  'linear-gradient(to right,#0acffe,#495aff)',
  'linear-gradient(to top,#48c6ef,#6f86d6)',
  // Vibrant / playful
  'linear-gradient(135deg,#a78bfa,#f472b6)',
  'linear-gradient(109.6deg,#F635A6,#36D860)',
  'linear-gradient(to top,#c471f5,#fa71cd)',
  'linear-gradient(to top,#a18cd1,#fbc2eb)',
  'linear-gradient(135deg,#FBC8B4,#2447B1)',
  // Greens
  'linear-gradient(120deg,#d4fc79,#96e6a1)',
  'linear-gradient(91deg,rgba(72,154,78,1) 5.2%,rgba(251,206,70,1) 95.9%)',
  // Moody / dark — good for dark-themed screen recordings
  'linear-gradient(135deg,#1e3a8a,#0c4a6e)',
  'linear-gradient(135deg,#0f172a,#334155)',
  'linear-gradient(109.6deg,rgba(15,2,2,1) 11.2%,rgba(36,163,190,1) 91.1%)',
  'linear-gradient(315deg,#EC0101,#5044A9)',
  'linear-gradient(to top,#fcc5e4,#fda34b 15%,#ff7882 35%,#c8699e 52%,#7046aa 71%,#0c1db8 87%,#020f75)',
  // Pastels
  'linear-gradient(135deg,#fde68a,#fca5a5)',
  'linear-gradient(to right,#f78ca0,#f9748f 19%,#fd868c 60%,#fe9a8b)',
  // Radial pops
  'radial-gradient(circle farthest-corner at 3.2% 49.6%,rgba(80,12,139,0.87) 0%,rgba(161,10,144,0.72) 83.6%)',
  'radial-gradient(circle farthest-corner at 10% 20%,rgba(2,37,78,1) 0%,rgba(4,56,126,1) 19.7%,rgba(85,245,221,1) 100.2%)'
];

// Bundled wallpapers — Vite resolves these to hashed URLs at build time, so
// the resulting `background.value` is a regular http/https/file URL that the
// canvas exporter can load via `new Image()` exactly like a user-uploaded one.
// Sources + licences are listed in CREDITS.md alongside the asset folder.
const wallpaperModules = import.meta.glob('../../assets/wallpapers/wallpaper-*.jpg', {
  eager: true,
  query: '?url',
  import: 'default'
});
const WALLPAPER_URLS: string[] = Object.entries(wallpaperModules)
  .sort(([a], [b]) => a.localeCompare(b))
  .map(([, url]) => url as string);

// Returns black or white depending on which contrasts better with the given
// hex colour — used so the hex preview label stays legible on any swatch.
function pickReadableTextColor(hex: string): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return '#ffffff';
  const r = parseInt(m[1].slice(0, 2), 16);
  const g = parseInt(m[1].slice(2, 4), 16);
  const b = parseInt(m[1].slice(4, 6), 16);
  // Perceptual luminance per WCAG.
  const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return lum > 0.55 ? '#0a0b0e' : '#ffffff';
}

// Curated color swatches — modern flat palette covering a good range of hues
// + dark/neutral options. Hex strings flow straight into background.value.
const COLOR_SWATCHES = [
  '#ef4444', '#f97316', '#f59e0b', '#eab308', '#84cc16', '#22c55e',
  '#10b981', '#14b8a6', '#06b6d4', '#0ea5e9', '#3b82f6', '#6366f1',
  '#8b5cf6', '#a855f7', '#d946ef', '#ec4899', '#f43f5e', '#78716c',
  '#0a0b0e', '#1f2937', '#475569', '#ffffff'
];
