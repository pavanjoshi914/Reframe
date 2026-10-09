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
      <div className="flex items-center justify-between border-b border-white/5 pb-2.5">
        <div className="flex items-center gap-2">
          <span className="font-semibold text-[var(--text)]">Captions</span>
          {captionCues.length > 0 && (
            <span className="rounded-full bg-sky-500/20 px-2 py-0.5 text-[10px] font-semibold text-sky-400">
              {captionCues.length}
            </span>
          )}
        </div>
        <label className="flex cursor-pointer items-center gap-1.5">
          <span className="text-[11px] text-[var(--muted)]">{captionSettings.enabled ? 'On' : 'Off'}</span>
          <input
            type="checkbox"
            checked={captionSettings.enabled}
            onChange={(e) => setCaptionSettings({ enabled: e.target.checked })}
            className="toggle-checkbox h-4 w-4 rounded accent-sky-500"
          />
        </label>
      </div>

      {/* Auto-Generation Box */}
      <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3 space-y-3">
        <div className="flex items-center justify-between">
          <span className="font-medium text-[var(--text)] flex items-center gap-1.5">
            <Sparkles size={13} className="text-sky-400" /> Auto-Generate
          </span>
          <div className="flex items-center gap-1.5">
            <Languages size={12} className="text-[var(--faint)]" />
            <select
              value={language}
              onChange={(e) => setLanguage(e.target.value)}
              className="rounded bg-[var(--panel-2)] px-2 py-1 text-[11px] text-[var(--text)] outline-none border border-white/5"
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
          <div className="space-y-1">
            <div className="flex justify-between text-[10px] text-sky-300">
              <span>{captionDownloadProgress > 0 ? 'Downloading Whisper Model...' : 'Initializing transcription...'}</span>
              <span>{captionDownloadProgress}%</span>
            </div>
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/10">
              <div
                className="h-full bg-sky-400 transition-all duration-300"
                style={{ width: `${Math.max(5, captionDownloadProgress)}%` }}
              />
            </div>
          </div>
        )}

        <button
          onClick={handleGenerateCaptions}
          disabled={captionGenerating || !recording}
          className="flex w-full items-center justify-center gap-2 rounded-lg bg-sky-500 hover:bg-sky-400 disabled:opacity-50 py-2 font-medium text-white shadow-md shadow-sky-500/20 transition"
        >
          {captionGenerating ? (
            <>
              <Loader2 size={13} className="animate-spin" />
              <span>Transcribing Audio...</span>
            </>
          ) : (
            <>
              <Sparkles size={13} />
              <span>{captionCues.length > 0 ? 'Regenerate Captions' : 'Generate Captions'}</span>
            </>
          )}
        </button>
      </div>

      {/* Selected Caption Cue Editor */}
      {selectedCue && (
        <div className="rounded-xl border border-sky-500/40 bg-sky-500/[0.08] p-3 space-y-2.5">
          <div className="flex items-center justify-between">
            <span className="font-semibold text-sky-300 flex items-center gap-1.5">
              Edit Selected Caption
            </span>
            <div className="flex items-center gap-1">
              <button
                onClick={() => setCurrent(selectedCue.startMs)}
                title="Seek playhead to cue"
                className="rounded p-1 text-sky-300 hover:bg-sky-500/20"
              >
                <Play size={11} />
              </button>
              <button
                onClick={() => deleteCaptionCue(selectedCue.id)}
                title="Delete this caption"
                className="rounded p-1 text-rose-400 hover:bg-rose-500/20"
              >
                <Trash2 size={11} />
              </button>
            </div>
          </div>

          <textarea
            value={selectedCue.text}
            onChange={(e) => updateCaptionCue(selectedCue.id, { text: e.target.value })}
            rows={2}
            className="w-full resize-none rounded-lg border border-sky-500/30 bg-black/40 p-2 text-xs text-white outline-none focus:border-sky-400"
            placeholder="Caption text..."
          />

          <div className="grid grid-cols-2 gap-2 text-[11px]">
            <div>
              <span className="text-[var(--faint)]">Start (s)</span>
              <input
                type="number"
                step="0.1"
                min="0"
                value={formatSeconds(selectedCue.startMs)}
                onChange={(e) => {
                  const ms = Math.round(parseFloat(e.target.value || '0') * 1000);
                  updateCaptionCue(selectedCue.id, { startMs: ms });
                }}
                className="mt-0.5 w-full rounded bg-black/30 px-2 py-1 text-white border border-white/5 outline-none"
              />
            </div>
            <div>
              <span className="text-[var(--faint)]">End (s)</span>
              <input
                type="number"
                step="0.1"
                min="0"
                value={formatSeconds(selectedCue.endMs)}
                onChange={(e) => {
                  const ms = Math.round(parseFloat(e.target.value || '0') * 1000);
                  updateCaptionCue(selectedCue.id, { endMs: ms });
                }}
                className="mt-0.5 w-full rounded bg-black/30 px-2 py-1 text-white border border-white/5 outline-none"
              />
            </div>
          </div>
        </div>
      )}

      {/* Style & Animation Settings */}
      <div className="space-y-3 pt-1">
        <span className="font-semibold text-[var(--muted)] uppercase tracking-wider text-[10px] flex items-center gap-1.5">
          <Sliders size={11} /> Style & Animation
        </span>

        {/* Animation Styles */}
        <div className="space-y-1">
          <span className="text-[var(--faint)]">Animation</span>
          <div className="grid grid-cols-2 gap-1">
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
                  className={`rounded-lg py-1.5 text-center font-medium transition ${
                    active
                      ? 'bg-sky-500 text-white shadow-sm shadow-sky-500/20'
                      : 'bg-[var(--panel-2)] text-[var(--muted)] hover:text-white hover:bg-white/10'
                  }`}
                >
                  {a.label}
                </button>
              );
            })}
          </div>
        </div>

        {/* Font Family & Size */}
        <div className="grid grid-cols-2 gap-2">
          <div>
            <span className="text-[var(--faint)]">Font</span>
            <select
              value={captionSettings.fontFamily}
              onChange={(e) => setCaptionSettings({ fontFamily: e.target.value })}
              className="mt-1 w-full rounded bg-[var(--panel-2)] px-2 py-1 text-white border border-white/5 outline-none"
            >
              {FONTS.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <div className="flex justify-between text-[var(--faint)]">
              <span>Size</span>
              <span>{captionSettings.fontSize}px</span>
            </div>
            <input
              type="range"
              min="20"
              max="72"
              value={captionSettings.fontSize}
              onChange={(e) => setCaptionSettings({ fontSize: parseInt(e.target.value, 10) })}
              className="mt-2 w-full accent-sky-500"
            />
          </div>
        </div>

        {/* Colors: Text & Highlight */}
        <div className="space-y-2">
          <div>
            <div className="flex items-center justify-between">
              <span className="text-[var(--faint)]">Text Color</span>
              <input
                type="color"
                value={captionSettings.textColor}
                onChange={(e) => setCaptionSettings({ textColor: e.target.value })}
                className="h-5 w-6 cursor-pointer rounded border border-white/10 bg-transparent p-0"
              />
            </div>
            <div className="mt-1 flex gap-1">
              {COLOR_PRESETS.map((c) => (
                <button
                  key={c}
                  onClick={() => setCaptionSettings({ textColor: c })}
                  className="h-4 w-4 rounded-full border border-white/20 transition hover:scale-110"
                  style={{ backgroundColor: c }}
                />
              ))}
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between">
              <span className="text-[var(--faint)]">Active Word (Karaoke)</span>
              <input
                type="color"
                value={captionSettings.highlightColor}
                onChange={(e) => setCaptionSettings({ highlightColor: e.target.value })}
                className="h-5 w-6 cursor-pointer rounded border border-white/10 bg-transparent p-0"
              />
            </div>
            <div className="mt-1 flex gap-1">
              {COLOR_PRESETS.map((c) => (
                <button
                  key={c}
                  onClick={() => setCaptionSettings({ highlightColor: c })}
                  className="h-4 w-4 rounded-full border border-white/20 transition hover:scale-110"
                  style={{ backgroundColor: c }}
                />
              ))}
            </div>
          </div>
        </div>

        {/* Background Box & Opacity */}
        <div className="space-y-1">
          <div className="flex justify-between text-[var(--faint)]">
            <span>Background Box</span>
            <span>{Math.round(captionSettings.backgroundOpacity * 100)}%</span>
          </div>
          <input
            type="range"
            min="0"
            max="1"
            step="0.05"
            value={captionSettings.backgroundOpacity}
            onChange={(e) => setCaptionSettings({ backgroundOpacity: parseFloat(e.target.value) })}
            className="w-full accent-sky-500"
          />
        </div>

        {/* Position Y */}
        <div className="space-y-1">
          <div className="flex justify-between text-[var(--faint)]">
            <span>Vertical Position</span>
            <span>{Math.round(captionSettings.posY * 100)}%</span>
          </div>
          <input
            type="range"
            min="0.1"
            max="0.95"
            step="0.02"
            value={captionSettings.posY}
            onChange={(e) => setCaptionSettings({ posY: parseFloat(e.target.value) })}
            className="w-full accent-sky-500"
          />
        </div>

        {/* Uppercase toggle */}
        <label className="flex cursor-pointer items-center justify-between pt-1">
          <span className="text-[var(--muted)]">All Caps (Uppercase)</span>
          <input
            type="checkbox"
            checked={captionSettings.uppercase}
            onChange={(e) => setCaptionSettings({ uppercase: e.target.checked })}
            className="h-4 w-4 rounded accent-sky-500"
          />
        </label>
      </div>

      {/* Cues List */}
      <div className="space-y-2 pt-2 border-t border-white/5">
        <div className="flex items-center justify-between">
          <span className="font-semibold text-[var(--muted)] uppercase tracking-wider text-[10px]">
            All Cues ({captionCues.length})
          </span>
          <button
            onClick={() => addCaptionCue({ startMs: currentMs })}
            className="flex items-center gap-1 rounded bg-[var(--panel-2)] px-2 py-0.5 text-[11px] text-sky-400 hover:bg-sky-500/20 transition"
          >
            <Plus size={11} /> Add at Playhead
          </button>
        </div>

        {captionCues.length === 0 ? (
          <div className="rounded-lg border border-dashed border-white/10 p-4 text-center text-[var(--faint)]">
            No captions yet. Click "Generate Captions" or press "C" to add manually.
          </div>
        ) : (
          <div className="max-h-56 overflow-y-auto space-y-1 rounded-lg border border-white/5 bg-black/20 p-1">
            {captionCues.map((cue) => {
              const isSelected = selectedCaptionId === cue.id;
              return (
                <div
                  key={cue.id}
                  onClick={() => {
                    selectCaption(cue.id);
                    setCurrent(cue.startMs);
                  }}
                  className={`flex cursor-pointer items-center justify-between gap-2 rounded-md p-1.5 transition ${
                    isSelected
                      ? 'bg-sky-500/30 text-white border border-sky-400/50'
                      : 'hover:bg-white/5 text-[var(--muted)]'
                  }`}
                >
                  <div className="flex min-w-0 flex-1 items-center gap-1.5">
                    <span className="shrink-0 font-mono text-[9px] text-[var(--faint)]">
                      {formatSeconds(cue.startMs)}s
                    </span>
                    <span className="truncate text-[11px] font-medium">{cue.text}</span>
                  </div>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      deleteCaptionCue(cue.id);
                    }}
                    className="shrink-0 p-1 text-[var(--faint)] hover:text-rose-400"
                  >
                    <Trash2 size={11} />
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
              className="flex items-center gap-1 rounded px-2 py-1 text-[11px] text-[var(--muted)] hover:text-white hover:bg-white/5 transition"
            >
              <Download size={11} /> Export SRT
            </button>
            <button
              onClick={() => {
                if (confirm('Clear all caption cues?')) clearCaptionCues();
              }}
              className="flex items-center gap-1 rounded px-2 py-1 text-[11px] text-rose-400 hover:bg-rose-500/10 transition"
            >
              <Trash2 size={11} /> Clear All
            </button>
          </div>
        )}

        {exportNotice && (
          <div className="rounded bg-emerald-500/20 p-1.5 text-center text-[10px] text-emerald-300">
            {exportNotice}
          </div>
        )}
      </div>
    </div>
  );
}
