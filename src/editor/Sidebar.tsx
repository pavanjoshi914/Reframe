import { useState } from 'react';
import { ChevronDown, ChevronRight, Download, Upload, X, Loader2, Circle, Square, RectangleHorizontal, Trash2, ZoomIn, Gauge, Crop, Bold, Italic, AlignLeft, AlignCenter, AlignRight, Type, Search, Flashlight } from 'lucide-react';
import { useEditor, type PolishPreset, DEFAULT_CROP_REGION, ANNOTATION_DEFAULTS, type LaneItem } from './store';
import { runExport, cancelExport } from './export';
import { CropModal } from './CropModal';
import { useT } from '../i18n';

const ZOOM_PRESETS = [1.25, 1.5, 1.8, 2.2, 3.5, 5];
const SPEED_PRESETS = [0.25, 0.5, 0.75, 1.25, 1.5, 2, 3, 5];

export function Sidebar() {
  const t = useT();
  const selectedItem = useEditor((s) => s.items.find((it) => it.id === s.selectedItemId) ?? null);
  const showSelection = selectedItem && (
    selectedItem.kind === 'zoom' ||
    selectedItem.kind === 'speed' ||
    selectedItem.kind === 'annotation' ||
    selectedItem.kind === 'magnify' ||
    selectedItem.kind === 'spotlight'
  );

  return (
    <div className="flex h-full w-[380px] flex-col overflow-hidden rounded-xl border border-white/5 bg-[#0e0f12]">
      <div className="flex-1 overflow-y-auto">
        {showSelection && (
          <Section title={t('side.selection')} defaultOpen>
            <SelectionSection />
          </Section>
        )}
        <Section title={t('side.composition')} defaultOpen>
          <CompositionSection />
        </Section>
        <Section title={t('side.style')} defaultOpen>
          <StyleSection />
        </Section>
        <Section title={t('side.videoEffects')} defaultOpen>
          <VideoEffectsSection />
        </Section>
      </div>
      <ExportSection />
    </div>
  );
}

function SelectionSection() {
  const t = useT();
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
            <ZoomIn size={12} /> {t('side.zoomLevel')}
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
          label={t('side.custom')}
          value={zoom}
          min={1}
          max={10}
          step={0.05}
          suffix="×"
          onChange={(v) => updateItem(item.id, { zoomLevel: v })}
        />
        <div className="grid grid-cols-2 gap-2">
          <NumberInput
            label={t('side.focusX')}
            value={item.zoomTargetX ?? 0.5}
            min={0}
            max={1}
            step={0.01}
            onChange={(v) => updateItem(item.id, { zoomTargetX: v })}
          />
          <NumberInput
            label={t('side.focusY')}
            value={item.zoomTargetY ?? 0.5}
            min={0}
            max={1}
            step={0.01}
            onChange={(v) => updateItem(item.id, { zoomTargetY: v })}
          />
        </div>
        <p className="text-[11px] text-white/40">{t('side.focusTip')}</p>
        <DeleteBtn onClick={() => { removeItem(item.id); selectItem(null); }} label={t('side.deleteZoom')} />
      </div>
    );
  }

  if (item.kind === 'annotation') {
    return <AnnotationEditor item={item} />;
  }

  if (item.kind === 'magnify' || item.kind === 'spotlight') {
    return <SpotlightMagnifyEditor item={item} />;
  }

  if (item.kind === 'speed') {
    const rate = item.speed ?? 1.5;
    return (
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <span className="flex items-center gap-1.5 text-xs text-white/70">
            <Gauge size={12} /> {t('side.playbackSpeed')}
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
          label={t('side.custom')}
          value={rate}
          min={0.1}
          max={10}
          step={0.05}
          suffix="×"
          onChange={(v) => updateItem(item.id, { speed: v })}
        />
        <DeleteBtn onClick={() => { removeItem(item.id); selectItem(null); }} label={t('side.deleteSpeed')} />
      </div>
    );
  }

  return null;
}

// Editor for a placed spotlight / magnify region: choose whether the lens
// follows the recorded cursor or sits at a fixed (manually dragged) point, and
// optionally stretch it across the whole video.
function SpotlightMagnifyEditor({ item }: { item: LaneItem }) {
  const t = useT();
  const updateItem = useEditor((s) => s.updateItem);
  const removeItem = useEditor((s) => s.removeItem);
  const selectItem = useEditor((s) => s.selectItem);
  const applyEffectWholeVideo = useEditor((s) => s.applyEffectWholeVideo);
  const durationMs = useEditor((s) => s.durationMs);
  const track = item.track ?? 'cursor';
  const isMag = item.kind === 'magnify';
  const wholeVideo = item.startMs <= 1 && item.endMs >= durationMs - 1;
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <span className="flex items-center gap-1.5 text-xs text-white/70">
          {isMag ? <Search size={12} /> : <Flashlight size={12} />} {t(isMag ? 'tl.magnify' : 'tl.spotlight')}
        </span>
        <span className="rounded bg-violet-500/15 px-1.5 py-0.5 font-mono text-[11px] text-violet-300">
          {((item.endMs - item.startMs) / 1000).toFixed(1)}s
        </span>
      </div>

      <div>
        <Label>{t('side.tracking')}</Label>
        <div className="grid grid-cols-2 gap-1.5">
          {(['cursor', 'manual'] as const).map((m) => (
            <button
              key={m}
              onClick={() => updateItem(item.id, { track: m })}
              className={
                'rounded-md px-2 py-1.5 text-xs font-medium ' +
                (track === m ? 'bg-emerald-500 text-black' : 'bg-white/5 text-white/70 hover:bg-white/10')
              }
            >
              {t(m === 'cursor' ? 'side.followCursor' : 'side.fixedPosition')}
            </button>
          ))}
        </div>
        <p className="mt-1 text-[11px] text-white/40">
          {t(track === 'cursor' ? 'side.followCursorTip' : 'side.fixedPositionTip')}
        </p>
      </div>

      <div>
        <button
          onClick={() => applyEffectWholeVideo(item.id)}
          disabled={wholeVideo}
          data-act="apply-whole-video"
          className="w-full rounded-md border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-medium text-white/80 hover:bg-white/10 disabled:opacity-40 disabled:hover:bg-white/5"
        >
          {t('side.applyWholeVideo')}
        </button>
        {wholeVideo && <p className="mt-1 text-[11px] text-emerald-300/70">{t('side.wholeVideoNote')}</p>}
      </div>

      <DeleteBtn onClick={() => { removeItem(item.id); selectItem(null); }} label={t('side.deleteEffect')} />
    </div>
  );
}

const ANNOTATION_FONT_FAMILIES = [
  { key: 'side.fontSystem', label: 'System Sans', value: 'system-ui, sans-serif' },
  { key: 'side.fontInter', label: 'Inter', value: 'Inter, system-ui, sans-serif' },
  { key: 'side.fontSerif', label: 'Serif', value: 'Georgia, "Times New Roman", serif' },
  { key: 'side.fontMono', label: 'Mono', value: 'ui-monospace, SFMono-Regular, Menlo, monospace' },
  { key: 'side.fontRounded', label: 'Rounded', value: '"SF Pro Rounded", "Avenir Next", "Trebuchet MS", sans-serif' }
];

const ANNOTATION_BG_PRESETS: { key: string; label: string; value: string | null }[] = [
  { key: 'side.bgDark', label: 'Dark', value: 'rgba(0,0,0,0.75)' },
  { key: 'side.bgLight', label: 'Light', value: 'rgba(255,255,255,0.9)' },
  { key: 'side.bgBrand', label: 'Brand', value: 'rgba(16,185,129,0.85)' },
  { key: 'side.bgWarning', label: 'Warning', value: 'rgba(234,88,12,0.85)' },
  { key: 'side.bgNone', label: 'None', value: null }
];

function AnnotationEditor({ item }: { item: LaneItem }) {
  const t = useT();
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
          <Type size={12} /> {t('tl.annotation')}
        </span>
        <span className="rounded bg-amber-500/15 px-1.5 py-0.5 font-mono text-[11px] text-amber-300">
          {((item.endMs - item.startMs) / 1000).toFixed(1)}s
        </span>
      </div>

      <textarea
        value={text}
        onChange={(e) => set({ text: e.target.value })}
        placeholder={t('side.enterText')}
        rows={3}
        className="w-full resize-none rounded border border-white/10 bg-black/30 px-2 py-1.5 text-sm text-white/90 placeholder:text-white/30 focus:border-emerald-400/40 focus:outline-none"
      />

      <div className="grid grid-cols-2 gap-2">
        <div>
          <Label>{t('side.font')}</Label>
          <select
            value={fontFamily}
            onChange={(e) => set({ fontFamily: e.target.value })}
            className="h-7 w-full rounded border border-white/10 bg-black/30 px-1.5 text-xs text-white/80 focus:outline-none"
          >
            {ANNOTATION_FONT_FAMILIES.map((f) => (
              <option key={f.value} value={f.value} style={{ fontFamily: f.value }}>
                {t(f.key)}
              </option>
            ))}
          </select>
        </div>
        <NumberInput
          label={t('side.fontSize')}
          value={fontSize}
          min={12}
          max={200}
          step={1}
          suffix="px"
          onChange={(v) => set({ fontSize: v })}
        />
      </div>

      <div className="flex items-center gap-1">
        <IconToggleBtn active={bold} onClick={() => set({ bold: !bold })} title={t('side.bold')}>
          <Bold size={13} />
        </IconToggleBtn>
        <IconToggleBtn active={italic} onClick={() => set({ italic: !italic })} title={t('side.italic')}>
          <Italic size={13} />
        </IconToggleBtn>
        <span className="mx-1 h-4 w-px bg-white/10" />
        <IconToggleBtn active={textAlign === 'left'} onClick={() => set({ textAlign: 'left' })} title={t('side.alignLeft')}>
          <AlignLeft size={13} />
        </IconToggleBtn>
        <IconToggleBtn active={textAlign === 'center'} onClick={() => set({ textAlign: 'center' })} title={t('side.alignCenter')}>
          <AlignCenter size={13} />
        </IconToggleBtn>
        <IconToggleBtn active={textAlign === 'right'} onClick={() => set({ textAlign: 'right' })} title={t('side.alignRight')}>
          <AlignRight size={13} />
        </IconToggleBtn>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div>
          <Label>{t('side.textColor')}</Label>
          <ColorPickRow
            value={textColor}
            onChange={(v) => set({ textColor: v })}
          />
        </div>
        <div>
          <Label>{t('side.background')}</Label>
          <div className="flex flex-wrap gap-1">
            {ANNOTATION_BG_PRESETS.map((p) => {
              const active = (backgroundColor ?? null) === p.value;
              return (
                <button
                  key={p.label}
                  onClick={() => set({ backgroundColor: p.value })}
                  title={t(p.key)}
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

      <p className="text-[11px] text-white/40">{t('side.annotationTip')}</p>
      <DeleteBtn onClick={() => { removeItem(item.id); selectItem(null); }} label={t('side.deleteAnnotation')} />
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
  const t = useT();
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
        <Label>{t('side.layout')}</Label>
        <select
          value={layoutPreset}
          onChange={(e) => setLayoutPreset(e.target.value as any)}
          className="w-full rounded-md border border-white/10 bg-black/30 px-2 py-1.5 text-sm"
        >
          <option value="pip-bottom-right">{t('side.pipBottomRight')}</option>
          <option value="pip-bottom-left">{t('side.pipBottomLeft')}</option>
          <option value="pip-top-right">{t('side.pipTopRight')}</option>
          <option value="pip-top-left">{t('side.pipTopLeft')}</option>
          <option value="side-by-side">{t('side.sideBySide')}</option>
        </select>
      </div>

      <div>
        <Label>{t('side.webcam')}</Label>
        <ToggleRow label={t('side.enable')} checked={webcam.enabled} onChange={(v) => setWebcam({ enabled: v })} />
        <RangeRow label={t('side.size')} value={webcam.size} min={0.08} max={0.6} step={0.01} onChange={(v) => setWebcam({ size: v })} fmt={(v) => `${Math.round(v * 100)}%`} />
        <div className="mt-2">
          <div className="mb-1 text-xs text-white/70">{t('side.shape')}</div>
          <div className="grid grid-cols-3 gap-1.5">
            <ShapeBtn active={webcam.shape === 'rectangle'} onClick={() => setWebcam({ shape: 'rectangle' })} label={t('side.rectangle')}>
              <RectangleHorizontal size={14} />
            </ShapeBtn>
            <ShapeBtn active={webcam.shape === 'square'} onClick={() => setWebcam({ shape: 'square' })} label={t('side.square')}>
              <Square size={14} />
            </ShapeBtn>
            <ShapeBtn active={webcam.shape === 'circle'} onClick={() => setWebcam({ shape: 'circle' })} label={t('side.circle')}>
              <Circle size={14} />
            </ShapeBtn>
          </div>
        </div>
      </div>

      <div>
        <Label>{t('side.background')}</Label>
        <div className="mb-2 flex gap-1">
          <BgTab active={background.mode === 'image'} onClick={() => setBackground({ mode: 'image', value: background.mode === 'image' ? background.value : '' })}>{t('side.image')}</BgTab>
          <BgTab active={background.mode === 'color'} onClick={() => setBackground({ mode: 'color', value: background.mode === 'color' ? background.value : '#1a1d23' })}>{t('side.color')}</BgTab>
          <BgTab active={background.mode === 'gradient'} onClick={() => setBackground({ mode: 'gradient', value: background.mode === 'gradient' ? background.value : 'linear-gradient(135deg,#fb923c,#ec4899)' })}>{t('side.gradient')}</BgTab>
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
              <Upload size={14} /> {t('side.uploadCustom')}
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
                  title={t('side.clearImage')}
                  aria-label={t('side.clearImage')}
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
  const t = useT();
  const polish = useEditor((s) => s.polish);
  const setPolish = useEditor((s) => s.setPolish);

  return (
    <div className="space-y-4">
      <div>
        <Label>{t('side.style')}</Label>
        <div className="grid grid-cols-3 gap-1.5">
          {(['subtle', 'soft', 'dramatic'] as PolishPreset[]).map((p) => (
            <button
              key={p}
              onClick={() => setPolish(p)}
              className={
                'rounded-md px-2 py-1.5 text-xs font-medium ' +
                (polish === p ? 'bg-emerald-500 text-black' : 'bg-white/5 text-white/70 hover:bg-white/10')
              }
            >
              {t('side.' + p)}
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
  const t = useT();
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
      <ToggleRow label={t('side.blurBg')} checked={effects.blurBg} onChange={(v) => setEffect('blurBg', v)} />
      <div className="grid grid-cols-2 gap-x-3 gap-y-1">
        <RangeRow label={t('side.shadow')} value={effects.shadowPct} min={0} max={100} step={1} onChange={(v) => setEffect('shadowPct', v)} fmt={(v) => `${v}%`} />
        <RangeRow label={t('side.roundness')} value={effects.roundnessPx} min={0} max={40} step={1} onChange={(v) => setEffect('roundnessPx', v)} fmt={(v) => `${v}px`} />
        <RangeRow label={t('side.padding')} value={effects.paddingPct} min={0} max={100} step={1} onChange={(v) => setEffect('paddingPct', v)} fmt={(v) => `${v}%`} />
        <RangeRow label={t('side.motionBlur')} value={Math.round(effects.motionBlur * 100)} min={0} max={80} step={1} onChange={(v) => setEffect('motionBlur', v / 100)} fmt={(v) => `${v}%`} />
        <RangeRow label={t('side.spotlight')} value={Math.round((effects.cursorSpotlight ?? 0) * 100)} min={0} max={100} step={1} onChange={(v) => setEffect('cursorSpotlight', v / 100)} fmt={(v) => `${v}%`} />
        <RangeRow label={t('side.magnifier')} value={Math.round((effects.cursorMagnifier ?? 0) * 100)} min={0} max={100} step={1} onChange={(v) => setEffect('cursorMagnifier', v / 100)} fmt={(v) => `${v}%`} />
      </div>
      <div className="flex gap-2">
        <button
          onClick={() => setCropOpen(true)}
          disabled={!fileUrl}
          className="flex flex-1 items-center justify-center gap-2 rounded-md border border-white/10 bg-black/30 px-3 py-2 text-sm hover:bg-white/5 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          <Crop size={14} /> {cropActive ? t('side.editCrop') : t('side.cropVideo')}
        </button>
        {cropActive && (
          <button
            onClick={() => setCropRegion(DEFAULT_CROP_REGION)}
            className="rounded-md border border-white/10 bg-white/5 px-2 text-xs text-white/70 hover:bg-white/10"
            title={t('side.clearCrop')}
          >
            {t('common.reset')}
          </button>
        )}
      </div>
      {cropOpen && <CropModal onClose={() => setCropOpen(false)} />}
    </div>
  );
}

function ExportSection() {
  const t = useT();
  const fmt = useEditor((s) => s.exportFormat);
  const setFmt = useEditor((s) => s.setExportFormat);
  const q = useEditor((s) => s.exportQuality);
  const setQ = useEditor((s) => s.setExportQuality);
  const fileUrl = useEditor((s) => s.fileUrl);
  const [busy, setBusy] = useState<null | BusyState>(null);

  async function handleExport() {
    if (!fileUrl) {
      alert(t('editor.noRecording'));
      return;
    }
    if (busy) return;
    try {
      setBusy({ phase: 'Preparing', pct: 0 });
      await runExport({
        onProgress: (phase, pct, detail) =>
          setBusy((prev) => ({
            phase,
            pct,
            // Keep the last frame counters / preview when a tick omits them, so
            // the modal doesn't flicker between updates.
            frame: detail?.frame ?? prev?.frame,
            totalFrames: detail?.totalFrames ?? prev?.totalFrames,
            preview: detail?.preview ?? prev?.preview
          }))
      });
    } catch (err) {
      console.error('export failed', err);
      alert(t('editor.exportFailed', { msg: (err as Error).message }));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="border-t border-white/5 bg-black/30 p-4">
      <Label>{t('side.format')}</Label>
      <div className="mb-3 grid grid-cols-3 gap-1.5">
        <ChipBtn active={fmt === 'mp4'} onClick={() => setFmt('mp4')}>MP4</ChipBtn>
        <ChipBtn active={fmt === 'webm'} onClick={() => setFmt('webm')}>WebM</ChipBtn>
        <ChipBtn active={fmt === 'gif'} onClick={() => setFmt('gif')}>GIF</ChipBtn>
      </div>
      <Label>{t('side.quality')}</Label>
      <div className="mb-4 grid grid-cols-3 gap-1.5">
        <ChipBtn active={q === 'low'} onClick={() => setQ('low')}>{t('side.low')}</ChipBtn>
        <ChipBtn active={q === 'medium'} onClick={() => setQ('medium')}>{t('side.medium')}</ChipBtn>
        <ChipBtn active={q === 'high'} onClick={() => setQ('high')}>{t('side.high')}</ChipBtn>
      </div>
      <button
        onClick={handleExport}
        disabled={!!busy || !fileUrl}
        className="flex w-full items-center justify-center gap-2 rounded-md bg-emerald-500 px-4 py-2.5 text-sm font-semibold text-black hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {busy ? <Loader2 size={16} className="animate-spin" /> : <Download size={16} />}
        {busy ? `${Math.round(busy.pct)}%` : t('side.exportVideo')}
      </button>
      {busy && <ExportProgressModal busy={busy} onCancel={() => cancelExport()} />}
    </div>
  );
}

type BusyState = { phase: string; pct: number; frame?: number; totalFrames?: number; preview?: string };

// Maps the exporter's coarse English stage names to localized labels.
const EXPORT_STAGE_LABELS: Record<string, string> = {
  Preparing: 'export.preparing',
  Encoding: 'export.encoding',
  'Encoding GIF': 'export.encodingGif',
  'Encoding audio': 'export.encodingAudio',
  Saving: 'export.saving',
  Cancelled: 'export.cancelled',
  Done: 'export.done'
};

// openscreen-style export progress popup: a live "frame being processed"
// thumbnail, a progress bar with the frame counter + percentage, and Cancel.
function ExportProgressModal({ busy, onCancel }: { busy: BusyState; onCancel: () => void }) {
  const t = useT();
  const [cancelling, setCancelling] = useState(false);
  const stage = EXPORT_STAGE_LABELS[busy.phase] ? t(EXPORT_STAGE_LABELS[busy.phase]) : busy.phase;
  const pct = Math.round(busy.pct);
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 backdrop-blur-sm">
      <div className="w-[380px] rounded-2xl border border-white/10 bg-[#14161b] p-6 shadow-2xl">
        <div className="mb-1 flex items-center gap-2">
          <Loader2 size={16} className="animate-spin text-emerald-400" />
          <h2 className="text-sm font-semibold text-white">{t('export.title')}</h2>
        </div>
        <p className="mb-4 text-xs text-white/50">{cancelling ? t('export.cancelling') : stage}</p>
        <div className="mb-4 aspect-video w-full overflow-hidden rounded-lg border border-white/10 bg-black/40">
          {busy.preview ? (
            <img src={busy.preview} alt="" className="h-full w-full object-contain" />
          ) : (
            <div className="flex h-full items-center justify-center text-[11px] text-white/30">{t('export.preparing')}…</div>
          )}
        </div>
        <div className="mb-2 h-2 w-full overflow-hidden rounded-full bg-white/10">
          <div className="h-full rounded-full bg-emerald-500 transition-[width] duration-150" style={{ width: `${pct}%` }} />
        </div>
        <div className="mb-4 flex items-center justify-between text-[11px] text-white/50">
          <span>{busy.totalFrames ? t('export.frame', { n: busy.frame ?? 0, total: busy.totalFrames }) : ''}</span>
          <span className="font-mono text-white/70">{pct}%</span>
        </div>
        <button
          onClick={() => { setCancelling(true); onCancel(); }}
          disabled={cancelling}
          className="w-full rounded-md border border-white/10 bg-white/5 px-3 py-2 text-xs font-medium text-white/70 hover:bg-white/10 disabled:opacity-50"
        >
          {t('export.cancel')}
        </button>
      </div>
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
