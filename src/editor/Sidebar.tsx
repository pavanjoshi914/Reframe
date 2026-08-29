import { useEffect, useRef, useState } from 'react';
import { ChevronDown, ChevronRight, Download, Upload, X, Loader2, Circle, Square, RectangleHorizontal, Trash2, ZoomIn, Gauge, Crop, Bold, Italic, AlignLeft, AlignCenter, AlignRight, Type, Search, Flashlight } from 'lucide-react';
import { useEditor, type PolishPreset, DEFAULT_CROP_REGION, ANNOTATION_DEFAULTS, type LaneItem, type CursorStyle } from './store';
import { runExport, cancelExport } from './export';
import { SCENE_GROUPS, DEFAULT_SCENE_SETTINGS, sceneInstances } from './scenes';
import { CURSOR_GLYPHS, CURSOR_STYLE_IDS } from './cursorGlyphs';
import type { SceneInstance } from './card3d';
import { SupportDialog, shouldPromptAfterExport } from './SupportDialog';
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
    selectedItem.kind === 'spotlight' ||
    selectedItem.kind === 'blur' ||
    selectedItem.kind === 'rotation' ||
    selectedItem.kind === 'scene'
  );

  return (
    <div className="flex h-full w-[380px] flex-col overflow-hidden rounded-xl border border-white/5 bg-[#0e0f12]">
      <div className="flex-1 overflow-y-auto">
        {showSelection && (
          <Section title={t('side.selection')} defaultOpen>
            <SelectionSection />
          </Section>
        )}
        <Section title={t('side.cursor')} defaultOpen>
          <CursorSection />
        </Section>
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
        <ZoomStylePicker />
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

  if (item.kind === 'scene') {
    return (
      <div className="space-y-3">
        <SceneSection item={item} />
        <DeleteBtn onClick={() => { removeItem(item.id); selectItem(null); }} label={t('side.deleteScene')} />
      </div>
    );
  }

  if (item.kind === 'rotation') {
    return (
      <div className="space-y-3">
        <Rotation3DPanel item={item} />
        <DeleteBtn onClick={() => { removeItem(item.id); selectItem(null); }} label={t('side.deleteRotation')} />
      </div>
    );
  }

  if (item.kind === 'blur') {
    const style = item.blurStyle ?? 'blur';
    return (
      <div className="space-y-3">
        <p className="text-[11px] text-white/50">{t('side.blurTip')}</p>
        <div>
          <Label>{t('side.style')}</Label>
          <div className="grid grid-cols-2 gap-1.5">
            <CursorStyleBtn active={style === 'blur'} onClick={() => updateItem(item.id, { blurStyle: 'blur' })} label={t('side.blurGaussian')} />
            <CursorStyleBtn active={style === 'pixelate'} onClick={() => updateItem(item.id, { blurStyle: 'pixelate' })} label={t('side.blurPixelate')} />
          </div>
        </div>
        <RangeRow
          label={t('side.blurStrength')}
          value={Math.round((item.blurStrength ?? 0.5) * 100)}
          min={10}
          max={100}
          step={5}
          onChange={(v) => updateItem(item.id, { blurStrength: v / 100 })}
          fmt={(v) => `${v}%`}
        />
        <DeleteBtn onClick={() => { removeItem(item.id); selectItem(null); }} label={t('side.deleteBlur')} />
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
        <RangeRow
          label={t('side.webcamZoomFollow')}
          value={Math.round((webcam.zoomFollow ?? 0) * 100)}
          min={0}
          max={100}
          step={5}
          onChange={(v) => setWebcam({ zoomFollow: v / 100 })}
          fmt={(v) => (v === 0 ? t('side.webcamZoomFollowOff') : `${v}%`)}
        />
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

// Synthetic-cursor styling: a smoothed, scalable pointer + click ripples — the
// signature "smooth cursor" look of polished demo videos.
const CURSOR_STYLE_LABEL: Record<CursorStyle, string> = {
  system: 'side.cursorStyleSystem',
  arrow: 'side.cursorStyleArrow',
  modern: 'side.cursorStyleModern',
  sleek: 'side.cursorStyleSleek',
  retro: 'side.cursorStyleRetro',
  hand: 'side.cursorStyleHand',
  beam: 'side.cursorStyleBeam',
  ring: 'side.cursorStyleRing',
  dot: 'side.cursorStyleDot',
  paw: 'side.cursorStylePaw',
  emoji: 'side.cursorStyleEmoji'
};

// One pointer tile. The preview is drawn from the SAME path data the
// compositor renders, in the currently chosen colour, so the tile is a true
// preview rather than a stand-in icon.
// Emoji cursor: any emoji, not a fixed one. The grid is a shortcut for common
// picks; the input accepts anything the user types or pastes (including emoji
// the grid doesn't list and multi-codepoint ones like 👨‍💻 or 🇮🇳), and the OS
// emoji keyboard works in it too. Kept to a single glyph — a cursor is one
// symbol — using Intl.Segmenter so a ZWJ sequence counts as one character
// rather than being cut in half.
const EMOJI_QUICK = ['👆','👉','👋','🖐️','✌️','🤙','👀','✨','⭐','🔥','💡','🎯','❤️','🚀','🎉','🐱','🐶','🦊','🌈','☕'];

function firstGrapheme(v: string): string {
  const t = v.trim();
  if (!t) return '';
  try {
    const seg = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
    return [...seg.segment(t)][0]?.segment ?? t;
  } catch {
    return [...t][0] ?? t; // older runtimes: code points, close enough
  }
}

function EmojiCursorPicker() {
  const t = useT();
  const emoji = useEditor((s) => s.cursorFx.emoji);
  const setCursorFx = useEditor((s) => s.setCursorFx);
  return (
    <div className="mt-2 rounded-md border border-white/10 p-2">
      <div className="mb-1.5 flex items-center justify-between">
        <Label>{t('side.cursorEmoji')}</Label>
        <span className="text-[19px] leading-none">{emoji || '👆'}</span>
      </div>
      <div className="grid grid-cols-10 gap-1">
        {EMOJI_QUICK.map((e) => (
          <button
            key={e}
            type="button"
            title={e}
            onClick={() => setCursorFx({ emoji: e })}
            className={
              'rounded text-[16px] leading-none transition ' +
              (emoji === e ? 'bg-emerald-500/25 ring-1 ring-emerald-400/50' : 'hover:bg-white/10')
            }
          >
            {e}
          </button>
        ))}
      </div>
      <input
        type="text"
        value={emoji}
        onChange={(e) => setCursorFx({ emoji: firstGrapheme(e.target.value) })}
        placeholder={t('side.cursorEmojiPlaceholder')}
        aria-label={t('side.cursorEmoji')}
        className="mt-1.5 w-full rounded bg-white/5 px-2 py-1 text-center text-[16px] leading-relaxed outline-none ring-1 ring-white/10 focus:ring-emerald-400/50"
      />
      <p className="mt-1 text-[11px] text-white/40">{t('side.cursorEmojiTip')}</p>
    </div>
  );
}

function CursorStyleTile({
  id, label, color, active, onClick, emojiPreview
}: { id: CursorStyle; label: string; color: string; active: boolean; onClick: () => void; emojiPreview?: string }) {
  const g = CURSOR_GLYPHS[id];
  const outline = 'rgba(0,0,0,0.7)';
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-pressed={active}
      className={
        'flex flex-col items-center gap-1 rounded-md border p-1.5 transition ' +
        (active
          ? 'border-emerald-400 bg-emerald-500/15'
          : 'border-white/10 hover:border-emerald-400/40 hover:bg-emerald-500/10')
      }
    >
      <span className="flex h-7 w-full items-center justify-center">
        {id === 'system' ? (
          // 'system' has no single glyph — it follows the recording. Show the
          // two it swaps between most, so the tile says what it does.
          <span className="flex items-center gap-0.5">
            {(['arrow', 'beam'] as const).map((gid) => (
              <svg key={gid} viewBox={CURSOR_GLYPHS[gid].view} className="h-5 w-4" aria-hidden="true">
                <path
                  d={CURSOR_GLYPHS[gid].d}
                  fill={color}
                  stroke={outline}
                  strokeWidth="1.7"
                  strokeLinejoin="round"
                  paintOrder="stroke"
                />
              </svg>
            ))}
          </span>
        ) : id === 'ring' || id === 'dot' ? (
          <svg viewBox="-10 -10 20 20" className="h-6 w-6" aria-hidden="true">
            <circle
              cx="0" cy="0" r={id === 'dot' ? 6.5 : 7}
              fill={id === 'dot' ? color : 'none'}
              stroke={id === 'dot' ? outline : color}
              strokeWidth={id === 'dot' ? 1.2 : 2.6}
            />
          </svg>
        ) : g?.char ? (
          <span className="text-[19px] leading-none">{id === 'emoji' ? emojiPreview || g.char : g.char}</span>
        ) : (
          <svg viewBox={g.view} className="h-6 w-6" aria-hidden="true">
            <path
              d={g.d}
              fill={color}
              stroke={outline}
              strokeWidth="1.7"
              strokeLinejoin="round"
              paintOrder="stroke"
            />
            {g.detail && (
              <path d={g.detail} fill="none" stroke={outline} strokeWidth="0.9" strokeLinecap="round" />
            )}
          </svg>
        )}
      </span>
      <span className={'w-full truncate text-center text-[10px] leading-tight ' + (active ? 'font-semibold text-emerald-300' : 'text-white/55')}>
        {label}
      </span>
    </button>
  );
}
const CURSOR_COLORS = ['#ffffff', '#111111', '#34d399', '#f59e0b', '#ef4444', '#3b82f6'];

function CursorSection() {
  const t = useT();
  const cursorFx = useEditor((s) => s.cursorFx);
  const setCursorFx = useEditor((s) => s.setCursorFx);
  const hasCursorData = useEditor((s) => s.cursorSamples.length > 0);
  // A hide-cursor clip has NO baked-in cursor, so the synthetic one is the only
  // cursor there is — it's always shown (no on/off toggle); the user styles it
  // instead. Non-hide recordings keep the toggle (cursor is optional on top).
  const hideCursorClip = useEditor((s) => !!s.recording?.hideCursor);
  const on = cursorFx.enabled || hideCursorClip;
  const style = cursorFx.style ?? 'system';
  const color = cursorFx.color ?? '#ffffff';
  return (
    <div className="space-y-3">
      {!hideCursorClip && (
        <div data-cursorctl="enabled">
          <ToggleRow label={t('side.smoothCursor')} checked={cursorFx.enabled} onChange={(v) => setCursorFx({ enabled: v })} />
        </div>
      )}
      {on && (
        <>
          <div data-cursorctl="idle">
            <ToggleRow
              label={t('side.hideWhenIdle')}
              checked={!!cursorFx.hideWhenIdle}
              onChange={(v) => setCursorFx({ hideWhenIdle: v })}
            />
            <p className="mt-1 text-[11px] text-white/40">{t('side.hideWhenIdleTip')}</p>
          </div>
          <div data-cursorctl="style">
            <Label>{t('side.style')}</Label>
            <div className="grid grid-cols-4 gap-1.5">
              {CURSOR_STYLE_IDS.map((id) => (
                <CursorStyleTile
                  key={id}
                  id={id}
                  label={t(CURSOR_STYLE_LABEL[id])}
                  color={color}
                  active={style === id}
                  emojiPreview={cursorFx.emoji}
                  onClick={() => setCursorFx({ style: id })}
                />
              ))}
            </div>
            {style === 'emoji' ? <EmojiCursorPicker /> : null}
          </div>
          <div data-cursorctl="color">
            <Label>{t('side.color')}</Label>
            <div className="flex items-center gap-1.5">
              {CURSOR_COLORS.map((c) => (
                <button
                  key={c}
                  aria-label={`Cursor color ${c}`}
                  title={c}
                  onClick={() => setCursorFx({ color: c })}
                  className={
                    'h-6 w-6 rounded-full transition ' +
                    (color.toLowerCase() === c.toLowerCase() ? 'ring-2 ring-emerald-400' : 'ring-1 ring-white/15 hover:ring-white/40')
                  }
                  style={{ backgroundColor: c }}
                />
              ))}
              <input
                type="color"
                value={color}
                onChange={(e) => setCursorFx({ color: e.target.value })}
                className="h-6 w-6 shrink-0 cursor-pointer rounded border border-white/10 bg-transparent"
                aria-label={t('side.color')}
              />
            </div>
          </div>
          <div data-cursorctl="size">
            <RangeRow
              label={t('side.cursorSize')}
              value={Math.round(cursorFx.size * 100)}
              min={50}
              max={300}
              step={10}
              onChange={(v) => setCursorFx({ size: v / 100 })}
              fmt={(v) => `${(v / 100).toFixed(1)}×`}
            />
          </div>
          <div data-cursorctl="smoothing">
            <RangeRow
              label={t('side.cursorSmoothing')}
              value={Math.round((cursorFx.smoothing ?? 0.5) * 100)}
              min={0}
              max={100}
              step={5}
              onChange={(v) => setCursorFx({ smoothing: v / 100 })}
              fmt={(v) => (v === 0 ? t('side.cursorSmoothingOff') : `${v}%`)}
            />
          </div>
          <div data-cursorctl="motionblur">
            <RangeRow
              label={t('side.cursorMotionBlur')}
              value={Math.round((cursorFx.motionBlur ?? 0) * 100)}
              min={0}
              max={100}
              step={5}
              onChange={(v) => setCursorFx({ motionBlur: v / 100 })}
              fmt={(v) => (v === 0 ? t('side.cursorSmoothingOff') : `${v}%`)}
            />
          </div>
          <div data-cursorctl="tilt">
            <RangeRow
              label={t('side.cursorTilt')}
              value={Math.round((cursorFx.tilt ?? 0) * 100)}
              min={0}
              max={100}
              step={5}
              onChange={(v) => setCursorFx({ tilt: v / 100 })}
              fmt={(v) => (v === 0 ? t('side.cursorSmoothingOff') : `${v}%`)}
            />
          </div>
          <div data-cursorctl="clicks">
            <ToggleRow label={t('side.clickHighlights')} checked={cursorFx.clicks} onChange={(v) => setCursorFx({ clicks: v })} />
          </div>
        </>
      )}
      <p className="text-[11px] text-white/40">
        {on && !hasCursorData ? t('side.cursorNoData') : t('side.cursorTip')}
      </p>
    </div>
  );
}

function CursorStyleBtn({ active, onClick, label }: { active: boolean; onClick: () => void; label: string }) {
  return (
    <button
      onClick={onClick}
      title={label}
      aria-pressed={active}
      className={
        'rounded-md px-1.5 py-1.5 text-[11px] font-medium ' +
        (active ? 'bg-emerald-500 text-black' : 'bg-white/5 text-white/70 hover:bg-white/10')
      }
    >
      {label}
    </button>
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
  const [askSupport, setAskSupport] = useState(false);

  async function handleExport() {
    if (!fileUrl) {
      alert(t('editor.noRecording'));
      return;
    }
    if (busy) return;
    try {
      setBusy({ phase: 'Preparing', pct: 0 });
      const saved = await runExport({
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
      // Only after a file genuinely reached disk, and only once the user has a
      // couple of exports behind them.
      if (saved && shouldPromptAfterExport()) setAskSupport(true);
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
      {askSupport && <SupportDialog onClose={() => setAskSupport(false)} />}
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
// Encouraging messages shown during the (long) encode phase, advancing with
// progress so the wait feels like it's going somewhere ("almost there…").
function cheerKey(pct: number): string {
  if (pct < 25) return 'export.cheer1';
  if (pct < 50) return 'export.cheer2';
  if (pct < 75) return 'export.cheer3';
  if (pct < 92) return 'export.cheer4';
  return 'export.cheer5';
}

function ExportProgressModal({ busy, onCancel }: { busy: BusyState; onCancel: () => void }) {
  const t = useT();
  const [cancelling, setCancelling] = useState(false);
  const stage = EXPORT_STAGE_LABELS[busy.phase] ? t(EXPORT_STAGE_LABELS[busy.phase]) : busy.phase;
  const pct = Math.round(busy.pct);
  const encoding = busy.phase === 'Encoding' || busy.phase === 'Encoding GIF';
  const subtitle = cancelling ? t('export.cancelling') : encoding ? t(cheerKey(pct)) : stage;
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 backdrop-blur-sm">
      <div className="w-[380px] rounded-2xl border border-white/10 bg-[#14161b] p-6 shadow-2xl">
        <div className="mb-1 flex items-center gap-2">
          <Loader2 size={16} className="animate-spin text-emerald-400" />
          <h2 className="text-sm font-semibold text-white">{t('export.title')}</h2>
        </div>
        <p className="mb-4 text-xs text-white/50 transition-opacity">{subtitle}</p>
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

// How zoom transitions move. Document-level, not per-region: mixing a snappy
// zoom with a cinematic one in the same video reads as a mistake, so the choice
// applies to every zoom at once.
function ZoomStylePicker() {
  const t = useT();
  const zoomStyle = useEditor((s) => s.zoomStyle);
  const setZoomStyle = useEditor((s) => s.setZoomStyle);
  return (
    <div className="mt-2">
      <div className="mb-1 text-xs text-white/70">{t('side.zoomStyle')}</div>
      <div className="grid grid-cols-2 gap-1.5">
        <ChipBtn active={zoomStyle === 'cinematic'} onClick={() => setZoomStyle('cinematic')}>
          {t('side.zoomStyleCinematic')}
        </ChipBtn>
        <ChipBtn active={zoomStyle === 'snappy'} onClick={() => setZoomStyle('snappy')}>
          {t('side.zoomStyleSnappy')}
        </ChipBtn>
      </div>
      <p className="mt-1 text-[11px] text-white/40">{t('side.zoomStyleTip')}</p>
    </div>
  );
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

// 3D rotation controls for a zoom: Tilt X / Tilt Y / Spin Z, each with a Start
// and an End keyframe. The sliders edit whichever keyframe is selected; the
// card's rotation interpolates Start→End across the zoom (and rides the zoom's
// ease in/out). "End" values are stored only once the user touches them — an
// untouched End means "same as Start" (holds), which is the common case.
// Ready-made looks, modelled on the camera moves the 3D demo tools trade in
// (Screen Studio's 3D Motion, TiltIt's camera presets): orbits, swings,
// reveals and drifts first, held poses second. `s` is the Start keyframe
// [tiltX, tiltY, spinZ]; presets with an `e` animate Start→End across the
// region, the rest hold one pose (End overrides cleared).
type RotPreset = { key: string; s: [number, number, number]; e?: [number, number, number] };
const ROT_MOTIONS: RotPreset[] = [
  // Entrances — land flat, so they read as the card arriving.
  { key: 'swingInL', s: [0, -45, 0], e: [0, 0, 0] },
  { key: 'swingInR', s: [0, 45, 0], e: [0, 0, 0] },
  { key: 'riseUp', s: [40, 0, 0], e: [0, 0, 0] },
  { key: 'cornerPeel', s: [18, -38, 6], e: [0, 0, 0] },
  { key: 'straighten', s: [10, 24, -8], e: [0, 0, 0] },
  // Sweeps — continuous motion across the whole region.
  { key: 'orbitLR', s: [12, -32, 0], e: [12, 32, 0] },
  { key: 'orbitRL', s: [12, 32, 0], e: [12, -32, 0] },
  { key: 'turntable', s: [24, -45, 0], e: [24, 45, 0] },
  { key: 'pendulum', s: [8, 24, 6], e: [8, -24, -6] },
  { key: 'dutchRoll', s: [4, -10, -14], e: [4, 10, 14] },
  // Exits — start flat and lean away, for outros.
  { key: 'fallBack', s: [0, 0, 0], e: [35, 0, 0] },
  { key: 'heroDrift', s: [0, 0, 0], e: [14, 30, -6] }
];
const ROT_POSES: RotPreset[] = [
  { key: 'showcaseL', s: [0, -28, 0] },
  { key: 'showcaseR', s: [0, 28, 0] },
  { key: 'isoL', s: [28, 38, -10] },
  { key: 'isoR', s: [28, -38, 10] },
  { key: 'laidBack', s: [32, 0, 0] },
  { key: 'dutch', s: [6, 14, -10] }
];

// CSS mirror of card3d's X→Y→Z rotation order, for the palette thumbnails —
// a real 3D preview of each preset, no image assets. Signs verified against
// the WebGL render so the thumbnail leans the same way as the card will.
const thumbTransform = (v: [number, number, number]) =>
  `perspective(140px) rotateX(${-v[0]}deg) rotateY(${v[1]}deg) rotateZ(${-v[2]}deg)`;

function PresetThumb({ p, onApply, label }: { p: RotPreset; onApply: () => void; label: string }) {
  return (
    <button
      type="button"
      onClick={onApply}
      title={label}
      className="group flex flex-col items-center gap-1 rounded-md border border-white/10 p-1.5 hover:border-emerald-400/40 hover:bg-emerald-500/10"
    >
      <span className="relative flex h-12 w-full items-center justify-center overflow-hidden rounded bg-black/40">
        {/* End pose as a ghost so a motion's tile shows where it's going. */}
        {p.e ? (
          <span
            aria-hidden="true"
            className="absolute h-7 w-11 rounded-[3px] border border-white/25"
            style={{ transform: thumbTransform(p.e) }}
          />
        ) : null}
        <span
          aria-hidden="true"
          className="absolute h-7 w-11 rounded-[3px] bg-gradient-to-br from-emerald-300/90 to-emerald-600/70 shadow"
          style={{ transform: thumbTransform(p.s) }}
        >
          <span className="mx-1 mt-1 block h-0.5 w-5 rounded bg-black/30" />
          <span className="mx-1 mt-0.5 block h-0.5 w-7 rounded bg-black/20" />
        </span>
        {p.e ? (
          <span className="absolute bottom-0.5 right-1 font-mono text-[9px] text-emerald-300/80">⇢</span>
        ) : null}
      </span>
      <span className="w-full truncate text-center text-[10px] leading-tight text-white/60 group-hover:text-white/90">
        {label}
      </span>
    </button>
  );
}

function Rotation3DPanel({ item }: { item: LaneItem }) {
  const t = useT();
  const updateItem = useEditor((s) => s.updateItem);
  const setCurrent = useEditor((s) => s.setCurrent);
  const setPlaying = useEditor((s) => s.setPlaying);
  const [kf, setKf] = useState<'start' | 'end'>('start');
  // Where on the timeline each keyframe's pose is actually visible: the region
  // eases in over ROT_TRANSITION_MS, so Start's pose holds from start+500ms
  // (same convention as previewPointFor); End's pose is exact at endMs.
  const seekKf = (which: 'start' | 'end') => {
    setKf(which);
    setPlaying(false);
    setCurrent(which === 'start' ? Math.min(item.endMs, item.startMs + 500) : item.endMs);
  };
  const get = (axis: 'tiltX' | 'tiltY' | 'spinZ') =>
    kf === 'start' ? (item[axis] ?? 0) : (item[`${axis}End` as const] ?? item[axis] ?? 0);
  const set = (axis: 'tiltX' | 'tiltY' | 'spinZ', v: number) =>
    updateItem(item.id, kf === 'start' ? { [axis]: v } : { [`${axis}End`]: v });
  const applyPreset = (p: RotPreset) => {
    updateItem(item.id, {
      tiltX: p.s[0], tiltY: p.s[1], spinZ: p.s[2],
      tiltXEnd: p.e?.[0], tiltYEnd: p.e?.[1], spinZEnd: p.e?.[2]
    });
    if (p.e) {
      // A motion is only legible in motion: play it through from the region
      // start so the preset previews itself the moment it's clicked.
      setKf('start');
      setCurrent(item.startMs);
      setPlaying(true);
    } else {
      seekKf('start');
    }
  };
  const any = [item.tiltX, item.tiltY, item.spinZ, item.tiltXEnd, item.tiltYEnd, item.spinZEnd].some((n) => n && Math.abs(n) > 1e-6);
  const fmt = (v: number) => `${v >= 0 ? '+' : ''}${Math.round(v)}°`;
  return (
    <div className="space-y-2 rounded-lg border border-white/10 p-3">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold text-white/80">{t('side.rotation3d')}</span>
        {any ? (
          <button
            type="button"
            onClick={() => updateItem(item.id, { tiltX: 0, tiltY: 0, spinZ: 0, tiltXEnd: undefined, tiltYEnd: undefined, spinZEnd: undefined })}
            className="text-[11px] text-white/50 hover:text-white"
          >
            {t('side.rotationReset')}
          </button>
        ) : null}
      </div>
      <div>
        <Label>{t('side.rotationKeyframe')}</Label>
        <div className="grid grid-cols-2 gap-1.5">
          <ChipBtn active={kf === 'start'} onClick={() => seekKf('start')}>{t('side.rotationStart')}</ChipBtn>
          <ChipBtn active={kf === 'end'} onClick={() => seekKf('end')}>{t('side.rotationEnd')}</ChipBtn>
        </div>
      </div>
      <div>
        <Label>{t('side.rotPresetMotions')}</Label>
        <div className="grid grid-cols-3 gap-1.5">
          {ROT_MOTIONS.map((p) => (
            <PresetThumb key={p.key} p={p} label={t(`side.rotPreset.${p.key}`)} onApply={() => applyPreset(p)} />
          ))}
        </div>
      </div>
      <div>
        <Label>{t('side.rotPresetPoses')}</Label>
        <div className="grid grid-cols-3 gap-1.5">
          {ROT_POSES.map((p) => (
            <PresetThumb key={p.key} p={p} label={t(`side.rotPreset.${p.key}`)} onApply={() => applyPreset(p)} />
          ))}
        </div>
      </div>
      <RangeRow label={t('side.tiltX')} value={get('tiltX')} min={-60} max={60} step={1} fmt={fmt} onChange={(v) => set('tiltX', v)} />
      <RangeRow label={t('side.tiltY')} value={get('tiltY')} min={-60} max={60} step={1} fmt={fmt} onChange={(v) => set('tiltY', v)} />
      <RangeRow label={t('side.spinZ')} value={get('spinZ')} min={-180} max={180} step={1} fmt={fmt} onChange={(v) => set('spinZ', v)} />
      <p className="text-[11px] text-white/40">{t('side.rotationTip')}</p>
    </div>
  );
}

// Multi-card 3D scenes (rings / streams / grids) — the selection panel for a
// 'scene' lane item: a visual palette (each tile is the real arrangement,
// rendered with CSS 3D from the same generator the compositor uses) plus the
// per-scene motion settings. Picking a preset re-plays the region.
function SceneSection({ item }: { item: LaneItem }) {
  const t = useT();
  const updateItem = useEditor((s) => s.updateItem);
  const setCurrent = useEditor((s) => s.setCurrent);
  const setPlaying = useEditor((s) => s.setPlaying);
  const paletteRef = useRef<HTMLDivElement>(null);
  // Bring the PALETTE into view once, when a scene item is first selected —
  // the sidebar may be scrolled anywhere when the chip is clicked.
  //
  // Browsing presets afterwards must not move the sidebar. Scrolling to the
  // settings on every pick (the old behaviour) made comparing effects
  // impossible: each click threw you down to Motion and you had to scroll back
  // up for the next one. The settings sit directly under the palette, so
  // they're one deliberate scroll away when you actually want them.
  useEffect(() => {
    paletteRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [item.id]);

  const pick = (id: string) => {
    updateItem(item.id, { scene: id });
    // A scene is only legible in motion — play it through from the start.
    setCurrent(item.startMs);
    setPlaying(true);
  };
  const d = DEFAULT_SCENE_SETTINGS;
  const shape = item.sceneShape ?? d.shape;
  const num = (v: number) => (Math.round(v * 100) / 100).toString();
  const anyMotion = [item.sceneSpeed, item.sceneZoom, item.sceneTiltX, item.sceneTiltY, item.sceneDepth, item.sceneSpacing, item.sceneRadius, item.sceneShape, item.scenePosX, item.scenePosY].some((v) => v !== undefined);
  return (
    <div className="space-y-3">
      <div ref={paletteRef}>
        <span className="text-xs font-semibold text-white/80">{t('side.scenes')}</span>
        <p className="mt-1 text-[11px] text-white/40">{t('side.scenesTip')}</p>
      </div>
      {SCENE_GROUPS.map((g) => (
        <div key={g.key}>
          <Label>{t(`side.sceneGroup.${g.key}`)}</Label>
          <div className="grid grid-cols-3 gap-1.5">
            {g.ids.map((id) => (
              <SceneThumb key={id} id={id} label={t(`side.scene.${id}`)} active={item.scene === id} onPick={() => pick(id)} />
            ))}
          </div>
        </div>
      ))}

      <div className="space-y-1 rounded-lg border border-white/10 p-3">
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold text-white/80">{t('side.sceneMotion')}</span>
          {anyMotion ? (
            <button
              type="button"
              onClick={() => updateItem(item.id, { sceneSpeed: undefined, sceneZoom: undefined, sceneTiltX: undefined, sceneTiltY: undefined, sceneDepth: undefined, sceneSpacing: undefined, sceneRadius: undefined, sceneShape: undefined, scenePosX: undefined, scenePosY: undefined })}
              className="text-[11px] text-white/50 hover:text-white"
            >
              {t('side.sceneResetMotion')}
            </button>
          ) : null}
        </div>
        <Label>{t('side.sceneShape')}</Label>
        <div className="grid grid-cols-5 gap-1">
          {(['1:1', '4:3', '3:2', '16:9', '9:16'] as const).map((sh) => (
            <ChipBtn key={sh} active={shape === sh} onClick={() => updateItem(item.id, { sceneShape: sh })}>{sh}</ChipBtn>
          ))}
        </div>
        <RangeRow label={t('side.sceneSpeed')} value={item.sceneSpeed ?? d.speed} min={0.25} max={3} step={0.25} fmt={(v) => `${num(v)}×`} onChange={(v) => updateItem(item.id, { sceneSpeed: v })} />
        <RangeRow label={t('side.sceneZoom')} value={item.sceneZoom ?? d.zoom} min={0.5} max={2} step={0.05} fmt={(v) => `${Math.round(v * 100)}%`} onChange={(v) => updateItem(item.id, { sceneZoom: v })} />
        <RangeRow label={t('side.tiltX')} value={item.sceneTiltX ?? d.tiltX} min={-45} max={45} step={1} fmt={(v) => `${v >= 0 ? '+' : ''}${Math.round(v)}°`} onChange={(v) => updateItem(item.id, { sceneTiltX: v })} />
        <RangeRow label={t('side.tiltY')} value={item.sceneTiltY ?? d.tiltY} min={-45} max={45} step={1} fmt={(v) => `${v >= 0 ? '+' : ''}${Math.round(v)}°`} onChange={(v) => updateItem(item.id, { sceneTiltY: v })} />
        <RangeRow label={t('side.sceneDepth')} value={item.sceneDepth ?? d.depth} min={0.25} max={2} step={0.05} fmt={(v) => `${num(v)}×`} onChange={(v) => updateItem(item.id, { sceneDepth: v })} />
        <RangeRow label={t('side.sceneSpacing')} value={item.sceneSpacing ?? d.spacing} min={0.5} max={2} step={0.05} fmt={(v) => `${Math.round(v * 100)}%`} onChange={(v) => updateItem(item.id, { sceneSpacing: v })} />
        <RangeRow label={t('side.sceneRadius')} value={item.sceneRadius ?? d.radius} min={0.5} max={2} step={0.05} fmt={(v) => `${num(v)}×`} onChange={(v) => updateItem(item.id, { sceneRadius: v })} />
        <Label>{t('side.scenePosition')}</Label>
        <ScenePositionPad
          x={item.scenePosX ?? d.posX}
          y={item.scenePosY ?? d.posY}
          onChange={(x, y) => updateItem(item.id, { scenePosX: x, scenePosY: y })}
        />
        <p className="text-[11px] text-white/40">{t('side.scenePositionTip')}</p>
      </div>
    </div>
  );
}

// Position pad: a miniature of the output frame; drag the marker to put the
// arrangement's centre anywhere. Pointer capture keeps the drag alive when the
// cursor leaves the pad.
function ScenePositionPad({ x, y, onChange }: { x: number; y: number; onChange: (x: number, y: number) => void }) {
  const padRef = useRef<HTMLDivElement>(null);
  const place = (e: React.PointerEvent) => {
    const r = padRef.current!.getBoundingClientRect();
    onChange(
      Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)),
      Math.max(0, Math.min(1, (e.clientY - r.top) / r.height))
    );
  };
  return (
    <div
      ref={padRef}
      onPointerDown={(e) => { (e.target as HTMLElement).setPointerCapture(e.pointerId); place(e); }}
      onPointerMove={(e) => { if (e.buttons & 1) place(e); }}
      className="relative aspect-video w-full cursor-crosshair select-none overflow-hidden rounded-md border border-white/10 bg-black/40"
    >
      <span aria-hidden="true" className="absolute inset-x-0 top-1/2 h-px bg-white/10" />
      <span aria-hidden="true" className="absolute inset-y-0 left-1/2 w-px bg-white/10" />
      <span
        className="absolute h-8 w-12 -translate-x-1/2 -translate-y-1/2 rounded-sm border-2 border-emerald-400 bg-emerald-400/20"
        style={{ left: `${x * 100}%`, top: `${y * 100}%` }}
      />
    </div>
  );
}

// One palette tile: the scene's cards at a fixed mid-motion instant, laid out
// with CSS 3D. Unit card = 30px wide; GL's +y-up flips to CSS y-down, and the
// rotation signs mirror card3d's conventions (same mapping as the rotation
// preset thumbnails).
const THUMB_UNIT = 30;
const thumbCache = new Map<string, SceneInstance[]>();
function thumbInstances(id: string): SceneInstance[] {
  let v = thumbCache.get(id);
  if (!v) {
    v = (sceneInstances(id, 0.3) ?? []).slice().sort((a, b) => a.oz - b.oz);
    thumbCache.set(id, v);
  }
  return v;
}
function SceneThumb({ id, label, active, onPick }: { id: string; label: string; active: boolean; onPick: () => void }) {
  const cards = thumbInstances(id);
  return (
    <button
      type="button"
      onClick={onPick}
      title={label}
      className={
        'group flex flex-col items-center gap-1 rounded-md border p-1 transition ' +
        (active ? 'border-emerald-400 bg-emerald-500/15' : 'border-white/10 hover:border-emerald-400/40 hover:bg-emerald-500/10')
      }
    >
      <span
        className="relative block h-14 w-full overflow-hidden rounded bg-black/40"
        style={{ perspective: '160px', perspectiveOrigin: '50% 50%' }}
      >
        <span className="absolute left-1/2 top-1/2 block" style={{ transformStyle: 'preserve-3d' }}>
          {cards.map((c, i) => (
            <span
              key={i}
              aria-hidden="true"
              className="absolute block rounded-[2px] bg-gradient-to-br from-emerald-300/90 to-emerald-600/70"
              style={{
                width: THUMB_UNIT,
                height: THUMB_UNIT * 9 / 16,
                left: -THUMB_UNIT / 2,
                top: -(THUMB_UNIT * 9 / 16) / 2,
                transform: `translate3d(${c.ox * THUMB_UNIT}px, ${-c.oy * THUMB_UNIT * 9 / 16}px, ${c.oz * THUMB_UNIT}px) rotateX(${-c.rx}deg) rotateY(${c.ry}deg) rotateZ(${-c.rz}deg) scale(${c.s})`
              }}
            />
          ))}
        </span>
      </span>
      <span className={'w-full truncate text-center text-[10px] leading-tight ' + (active ? 'font-semibold text-emerald-300' : 'text-white/60 group-hover:text-white/90')}>
        {label}
      </span>
    </button>
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
