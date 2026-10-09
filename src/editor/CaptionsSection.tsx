import { useEffect, useState } from 'react';
import {
  Sparkles,
  Loader2,
  Trash2,
  Plus,
  Download,
  Play,
  Sliders,
  Languages
} from 'lucide-react';
import { useEditor, type CaptionAnimation } from './store';

const LANGUAGES = [
  { code: 'auto', label: 'Auto-Detect' },
  { code: 'en', label: 'English' },
  { code: 'es', label: 'Spanish' },
  { code: 'fr', label: 'French' },
  { code: 'de', label: 'German' },
  { code: 'it', label: 'Italian' },
  { code: 'pt', label: 'Portuguese' },
  { code: 'ja', label: 'Japanese' },
  { code: 'zh', label: 'Chinese' },
  { code: 'hi', label: 'Hindi' },
  { code: 'ru', label: 'Russian' },
  { code: 'ko', label: 'Korean' },
  { code: 'ar', label: 'Arabic' }
];

const FONTS = [
  { id: 'Inter', label: 'Inter' },
  { id: 'Impact', label: 'Impact' },
  { id: 'Trebuchet MS', label: 'Trebuchet' },
  { id: 'Arial', label: 'Arial' },
  { id: 'system-ui', label: 'System' }
];

const COLOR_PRESETS = [
  '#ffffff',
  '#38bdf8', // sky
  '#fbbf24', // amber
  '#4ade80', // green
  '#f43f5e', // rose
  '#a855f7', // purple
  '#f97316'  // orange
];

function formatSeconds(ms: number): string {
  return (ms / 1000).toFixed(2);
}

function AppleSlider({
  label,
  value,
  min,
  max,
  step = 1,
  unit = '',
  onChange
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  unit?: string;
  onChange: (v: number) => void;
}) {
  const pct = max > min ? Math.max(0, Math.min(100, ((value - min) / (max - min)) * 100)) : 0;
  return (
    <div className="py-1.5 select-none">
      <div className="mb-1.5 flex items-center justify-between text-xs">
        <span className="font-medium text-[var(--muted)]">{label}</span>
        <span className="font-semibold text-[var(--text)] tabular-nums">{value}{unit}</span>
      </div>
      <div className="relative flex h-5 items-center">
        <div className="relative h-[5px] w-full rounded-full bg-[var(--track)] overflow-hidden">
          <div
            className="absolute left-0 top-0 h-full rounded-full bg-[#0A84FF]"
            style={{ width: `${pct}%` }}
          />
        </div>
        <div
          className="pointer-events-none absolute top-1/2 -translate-y-1/2 -translate-x-1/2 h-4 w-4 rounded-full bg-white shadow-[0_1px_4px_rgba(0,0,0,0.3)] border border-black/10"
          style={{ left: `calc(${pct}% + ${8 - pct * 0.16}px)` }}
        />
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={(e) => onChange(Number(e.target.value))}
          className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
        />
      </div>
    </div>
  );
}

function AppleSwitch({
  checked,
  onChange,
  ariaLabel
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  ariaLabel?: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full transition-colors duration-200 focus:outline-none ${
        checked ? 'bg-[#0A84FF]' : 'bg-[var(--track)] border border-[var(--btn-squircle-border)] hover:opacity-80'
      }`}
    >
      <span
        className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow-md transition-transform duration-200 ${
          checked ? 'translate-x-[18px]' : 'translate-x-[2px]'
        }`}
      />
    </button>
  );
}

export function CaptionsSection() {
  const recording = useEditor((s) => s.recording);
  const currentMs = useEditor((s) => s.currentMs);
  const setCurrent = useEditor((s) => s.setCurrent);

  const captionCues = useEditor((s) => s.captionCues);
  const captionSettings = useEditor((s) => s.captionSettings);
  const setCaptionSettings = useEditor((s) => s.setCaptionSettings);
  const selectedCaptionId = useEditor((s) => s.selectedCaptionId);
  const selectCaption = useEditor((s) => s.selectCaption);
  const addCaptionCue = useEditor((s) => s.addCaptionCue);
  const updateCaptionCue = useEditor((s) => s.updateCaptionCue);
  const deleteCaptionCue = useEditor((s) => s.deleteCaptionCue);
  const clearCaptionCues = useEditor((s) => s.clearCaptionCues);
  const setCaptionCues = useEditor((s) => s.setCaptionCues);

  const captionGenerating = useEditor((s) => s.captionGenerating);
  const setCaptionGenerating = useEditor((s) => s.setCaptionGenerating);
  const captionDownloadProgress = useEditor((s) => s.captionDownloadProgress);
  const captionDownloadStatus = useEditor((s) => s.captionDownloadStatus);
  const setCaptionDownloadStatus = useEditor((s) => s.setCaptionDownloadStatus);

  const [language, setLanguage] = useState('auto');
  const [exportNotice, setExportNotice] = useState<string | null>(null);

  useEffect(() => {
    const unsub = window.api.onCaptionDownloadProgress?.((p) => {
      setCaptionDownloadStatus('downloading', p);
    });
    return () => unsub?.();
  }, [setCaptionDownloadStatus]);

  const selectedCue = captionCues.find((c) => c.id === selectedCaptionId) ?? null;

  async function handleGenerateCaptions() {
    const videoPath = recording?.filePath;
    const webcamPath = recording?.webcamFilePath;
    if (!videoPath && !webcamPath) {
      alert('Please load or record a video first.');
      return;
    }

    try {
      setCaptionGenerating(true);
      setCaptionDownloadStatus('downloading', 0);

      const res = await window.api.generateCaptions({
        videoPath: videoPath || webcamPath!,
        webcamPath,
        language
      });
      if (res.error) {
        alert('Caption generation failed: ' + res.error);
      } else if (res.cues) {
        setCaptionCues(res.cues);
        setCaptionSettings({ enabled: true });
        if (res.cues.length > 0) {
          selectCaption(res.cues[0].id);
        }
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      alert('Error generating captions: ' + msg);
    } finally {
      setCaptionGenerating(false);
      setCaptionDownloadStatus('idle', 0);
    }
  }

  async function handleExportSrt() {
    if (captionCues.length === 0) return;
    const res = await window.api.exportCaptionsSrt({
      cues: captionCues,
      defaultName: 'captions'
    });
    if (res.success && res.path) {
      setExportNotice('Exported to ' + res.path.split(/[/\\]/).pop());
      setTimeout(() => setExportNotice(null), 4000);
    }
  }

  return (
    <div className="space-y-4 text-xs">
      {/* Enable Toggle & Header */}
      <div className="flex items-center justify-between border-b border-[var(--card-border)] pb-2.5">
        <div className="flex items-center gap-2">
          <span className="font-semibold text-[var(--text)]">Captions</span>
          {captionCues.length > 0 && (
            <span className="rounded-full bg-[#0A84FF]/20 px-2 py-0.5 text-[10px] font-semibold text-[#0A84FF]">
              {captionCues.length}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <AppleSwitch
            checked={captionSettings.enabled}
            onChange={(checked) => setCaptionSettings({ enabled: checked })}
            ariaLabel="Captions On/Off"
          />
        </div>
      </div>

      {/* Auto-Generation Box */}
      <div className="rounded-2xl border border-[var(--card-border)] bg-[var(--panel-2)] p-3.5 space-y-3">
        <div className="flex items-center justify-between">
          <span className="font-semibold text-[var(--text)] flex items-center gap-1.5 text-xs">
            <Sparkles size={14} className="text-[#0A84FF]" /> Auto-Generate
          </span>
          <div className="flex items-center gap-1.5">
            <Languages size={13} className="text-[var(--muted)]" />
            <select
              value={language}
              onChange={(e) => setLanguage(e.target.value)}
              className="rounded-xl border border-[var(--btn-squircle-border)] bg-[var(--field)] px-2.5 py-1 text-xs text-[var(--text)] outline-none hover:border-[var(--line-2)] transition cursor-pointer"
            >
              {LANGUAGES.map((l) => (
                <option key={l.code} value={l.code}>
                  {l.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        {captionDownloadStatus === 'downloading' && (
          <div className="space-y-1.5">
            <div className="flex justify-between text-[11px] text-[#0A84FF]">
              <span>{captionDownloadProgress > 0 ? 'Downloading Whisper Model...' : 'Initializing transcription...'}</span>
              <span className="font-mono font-semibold">{captionDownloadProgress}%</span>
            </div>
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-[var(--track)]">
              <div
                className="h-full bg-[#0A84FF] transition-all duration-300"
                style={{ width: `${Math.max(5, captionDownloadProgress)}%` }}
              />
            </div>
          </div>
        )}

        <button
          onClick={handleGenerateCaptions}
          disabled={captionGenerating || !recording}
          className="flex w-full items-center justify-center gap-2 rounded-xl bg-[#0A84FF] hover:brightness-110 active:brightness-95 disabled:opacity-50 py-2.5 text-xs font-semibold text-white shadow-[0_2px_12px_rgba(10,132,255,0.4)] transition"
        >
          {captionGenerating ? (
            <>
              <Loader2 size={14} className="animate-spin" />
              <span>Transcribing Audio...</span>
            </>
          ) : (
            <>
              <Sparkles size={14} />
              <span>{captionCues.length > 0 ? 'Regenerate Captions' : 'Generate Captions'}</span>
            </>
          )}
        </button>
      </div>

      {/* Selected Caption Cue Editor */}
      {selectedCue && (
        <div className="rounded-2xl border border-[#0A84FF]/40 bg-[#0A84FF]/[0.08] p-3.5 space-y-3">
          <div className="flex items-center justify-between">
            <span className="font-semibold text-[#0A84FF] flex items-center gap-1.5 text-xs">
              Edit Selected Caption
            </span>
            <div className="flex items-center gap-1">
              <button
                onClick={() => setCurrent(selectedCue.startMs)}
                title="Seek playhead to cue"
                className="rounded-lg p-1.5 text-[#0A84FF] hover:bg-[#0A84FF]/20 transition"
              >
                <Play size={12} />
              </button>
              <button
                onClick={() => deleteCaptionCue(selectedCue.id)}
                title="Delete this caption"
                className="rounded-lg p-1.5 text-rose-400 hover:bg-rose-500/20 transition"
              >
                <Trash2 size={12} />
              </button>
            </div>
          </div>

          <textarea
            value={selectedCue.text}
            onChange={(e) => updateCaptionCue(selectedCue.id, { text: e.target.value })}
            rows={2}
            className="w-full resize-none rounded-xl border border-[var(--card-border)] bg-[var(--field)] p-2.5 text-xs text-[var(--text)] outline-none focus:border-[#0A84FF] transition"
            placeholder="Caption text..."
          />

          <div className="grid grid-cols-2 gap-2 text-[11px]">
            <div>
              <span className="text-[var(--muted)] font-medium">Start (s)</span>
              <input
                type="number"
                step="0.1"
                min="0"
                value={formatSeconds(selectedCue.startMs)}
                onChange={(e) => {
                  const ms = Math.round(parseFloat(e.target.value || '0') * 1000);
                  updateCaptionCue(selectedCue.id, { startMs: ms });
                }}
                className="mt-1 w-full rounded-lg bg-[var(--field)] px-2.5 py-1 text-[var(--text)] border border-[var(--card-border)] outline-none focus:border-[#0A84FF]"
              />
            </div>
            <div>
              <span className="text-[var(--muted)] font-medium">End (s)</span>
              <input
                type="number"
                step="0.1"
                min="0"
                value={formatSeconds(selectedCue.endMs)}
                onChange={(e) => {
                  const ms = Math.round(parseFloat(e.target.value || '0') * 1000);
                  updateCaptionCue(selectedCue.id, { endMs: ms });
                }}
                className="mt-1 w-full rounded-lg bg-[var(--field)] px-2.5 py-1 text-[var(--text)] border border-[var(--card-border)] outline-none focus:border-[#0A84FF]"
              />
            </div>
          </div>
        </div>
      )}

      {/* Style & Animation Settings */}
      <div className="space-y-3.5 pt-1">
        <span className="font-semibold text-[var(--text)] text-xs flex items-center gap-1.5">
          <Sliders size={13} /> Style & Animation
        </span>

        {/* Animation Styles */}
        <div className="space-y-1.5">
          <span className="text-xs font-medium text-[var(--muted)]">Animation</span>
          <div className="grid grid-cols-2 gap-1.5">
            {(
              [
                { id: 'highlight', label: 'Karaoke' },
                { id: 'word', label: 'Pop In' },
                { id: 'bounce', label: 'Bounce' },
                { id: 'none', label: 'Classic' }
              ] as const
            ).map((a) => {
              const active = captionSettings.animation === a.id;
              return (
                <button
                  key={a.id}
                  onClick={() => setCaptionSettings({ animation: a.id as CaptionAnimation })}
                  className={`rounded-xl py-2 text-xs font-semibold transition-all duration-150 ${
                    active
                      ? 'bg-[#0A84FF] text-white shadow-[0_2px_10px_rgba(10,132,255,0.35)]'
                      : 'bg-[var(--btn-squircle)] text-[var(--muted)] border border-[var(--btn-squircle-border)] hover:bg-[var(--btn-squircle-hover)] hover:text-[var(--text)]'
                  }`}
                >
                  {a.label}
                </button>
              );
            })}
          </div>
        </div>

        {/* Font Family & Size */}
        <div className="space-y-3">
          <div>
            <span className="text-xs font-medium text-[var(--muted)]">Font</span>
            <select
              value={captionSettings.fontFamily}
              onChange={(e) => setCaptionSettings({ fontFamily: e.target.value })}
              className="mt-1.5 w-full rounded-xl border border-[var(--btn-squircle-border)] bg-[var(--field)] px-3 py-2 text-xs font-medium text-[var(--text)] outline-none hover:border-[var(--line-2)] transition cursor-pointer"
            >
              {FONTS.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <AppleSlider
              label="Size"
              value={captionSettings.fontSize}
              min={20}
              max={72}
              unit="px"
              onChange={(v) => setCaptionSettings({ fontSize: v })}
            />
          </div>
        </div>

        {/* Colors: Text & Highlight */}
        <div className="space-y-2.5 pt-1">
          <div>
            <div className="flex items-center justify-between text-xs">
              <span className="font-medium text-[var(--muted)]">Text Color</span>
              <input
                type="color"
                value={captionSettings.textColor}
                onChange={(e) => setCaptionSettings({ textColor: e.target.value })}
                className="h-6 w-6 cursor-pointer rounded-full border-0 bg-transparent p-0"
              />
            </div>
            <div className="mt-1.5 flex gap-1.5">
              {COLOR_PRESETS.map((c) => (
                <button
                  key={c}
                  onClick={() => setCaptionSettings({ textColor: c })}
                  className={`h-5 w-5 rounded-full transition-transform ${
                    captionSettings.textColor === c ? 'ring-2 ring-[#0A84FF] scale-110' : 'ring-1 ring-white/20 hover:scale-105'
                  }`}
                  style={{ backgroundColor: c }}
                />
              ))}
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between text-xs">
              <span className="font-medium text-[var(--muted)]">Active Word (Karaoke)</span>
              <input
                type="color"
                value={captionSettings.highlightColor}
                onChange={(e) => setCaptionSettings({ highlightColor: e.target.value })}
                className="h-6 w-6 cursor-pointer rounded-full border-0 bg-transparent p-0"
              />
            </div>
            <div className="mt-1.5 flex gap-1.5">
              {COLOR_PRESETS.map((c) => (
                <button
                  key={c}
                  onClick={() => setCaptionSettings({ highlightColor: c })}
                  className={`h-5 w-5 rounded-full transition-transform ${
                    captionSettings.highlightColor === c ? 'ring-2 ring-[#0A84FF] scale-110' : 'ring-1 ring-white/20 hover:scale-105'
                  }`}
                  style={{ backgroundColor: c }}
                />
              ))}
            </div>
          </div>
        </div>

        {/* Background Box & Opacity */}
        <AppleSlider
          label="Background Box"
          value={Math.round(captionSettings.backgroundOpacity * 100)}
          min={0}
          max={100}
          unit="%"
          onChange={(v) => setCaptionSettings({ backgroundOpacity: v / 100 })}
        />

        {/* Position Y */}
        <AppleSlider
          label="Vertical Position"
          value={Math.round(captionSettings.posY * 100)}
          min={10}
          max={95}
          unit="%"
          onChange={(v) => setCaptionSettings({ posY: v / 100 })}
        />

        {/* Uppercase toggle */}
        <div className="flex cursor-pointer items-center justify-between py-1">
          <span className="text-xs font-medium text-[var(--text)]">All Caps (Uppercase)</span>
          <AppleSwitch
            checked={captionSettings.uppercase}
            onChange={(checked) => setCaptionSettings({ uppercase: checked })}
            ariaLabel="All Caps"
          />
        </div>
      </div>

      {/* Cues List */}
      <div className="space-y-2.5 pt-3 border-t border-[var(--card-border)]">
        <div className="flex items-center justify-between">
          <span className="font-semibold text-[var(--muted)] uppercase tracking-wider text-[10px]">
            All Cues ({captionCues.length})
          </span>
          <button
            onClick={() => addCaptionCue({ startMs: currentMs })}
            className="flex items-center gap-1.5 rounded-lg bg-[var(--btn-squircle)] border border-[var(--btn-squircle-border)] px-2.5 py-1 text-[11px] font-medium text-[#0A84FF] hover:bg-[var(--btn-squircle-hover)] transition"
          >
            <Plus size={12} /> Add at Playhead
          </button>
        </div>

        {captionCues.length === 0 ? (
          <div className="rounded-xl border border-dashed border-[var(--card-border)] p-5 text-center text-xs text-[var(--muted)]">
            No captions yet. Click &quot;Generate Captions&quot; or press &quot;C&quot; to add manually.
          </div>
        ) : (
          <div className="max-h-56 overflow-y-auto space-y-1.5 rounded-xl border border-[var(--card-border)] bg-[var(--panel-2)] p-1.5">
            {captionCues.map((cue) => {
              const isSelected = selectedCaptionId === cue.id;
              return (
                <div
                  key={cue.id}
                  onClick={() => {
                    selectCaption(cue.id);
                    setCurrent(cue.startMs);
                  }}
                  className={`flex cursor-pointer items-center justify-between gap-2 rounded-xl p-2 transition ${
                    isSelected
                      ? 'bg-[#0A84FF]/20 text-[var(--text)] border border-[#0A84FF]/50 shadow-sm'
                      : 'bg-[var(--card)] border border-[var(--card-border)] text-[var(--text)] hover:bg-[var(--btn-squircle-hover)]'
                  }`}
                >
                  <div className="flex min-w-0 flex-1 items-center gap-2">
                    <span className="shrink-0 font-mono text-[10px] text-[var(--muted)] px-1 py-0.5 rounded bg-[var(--panel-3)] border border-[var(--card-border)]">
                      {formatSeconds(cue.startMs)}s
                    </span>
                    <span className="truncate text-xs font-medium">{cue.text}</span>
                  </div>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      deleteCaptionCue(cue.id);
                    }}
                    className="shrink-0 p-1 text-[var(--muted)] hover:text-rose-500 transition"
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
              );
            })}
          </div>
        )}

        {/* Footer Actions */}
        {captionCues.length > 0 && (
          <div className="flex items-center justify-between pt-1">
            <button
              onClick={handleExportSrt}
              className="flex items-center gap-1.5 rounded-lg bg-[var(--btn-squircle)] border border-[var(--btn-squircle-border)] px-2.5 py-1 text-[11px] font-medium text-[var(--text)] hover:bg-[var(--btn-squircle-hover)] transition"
            >
              <Download size={12} /> Export SRT
            </button>
            <button
              onClick={() => {
                if (confirm('Clear all caption cues?')) clearCaptionCues();
              }}
              className="flex items-center gap-1.5 rounded-lg bg-rose-500/10 border border-rose-500/20 px-2.5 py-1 text-[11px] font-medium text-rose-400 hover:bg-rose-500/20 transition"
            >
              <Trash2 size={12} /> Clear All
            </button>
          </div>
        )}

        {exportNotice && (
          <div className="rounded-xl bg-emerald-500/15 border border-emerald-500/30 p-2 text-center text-xs text-emerald-300">
            {exportNotice}
          </div>
        )}
      </div>
    </div>
  );
}
