import { useEffect, useMemo, useState } from 'react';
import { Check } from 'lucide-react';
import type { DesktopSource } from '@shared/ipc';

type Tab = 'screen' | 'window';

export function PickerApp() {
  const [sources, setSources] = useState<DesktopSource[]>([]);
  const [tab, setTab] = useState<Tab>('screen');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      const list = await window.api.getSources();
      if (!cancelled) {
        setSources(list);
        setLoading(false);
      }
    }
    load();
    const interval = window.setInterval(load, 2500);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, []);

  const screens = useMemo(() => sources.filter((s) => s.type === 'screen'), [sources]);
  const windows = useMemo(() => sources.filter((s) => s.type === 'window'), [sources]);
  const visible = tab === 'screen' ? screens : windows;
  const selected = sources.find((s) => s.id === selectedId) ?? null;

  function handleShare() {
    if (!selected) return;
    window.api.selectSource(selected);
  }

  return (
    <div className="flex h-screen w-screen items-center justify-center p-4">
      <div className="flex h-full w-full flex-col overflow-hidden rounded-2xl border border-white/10 bg-[#15171c]/95 shadow-2xl backdrop-blur-md">
        {/* Pill tabs */}
        <div className="flex items-center justify-center px-4 pt-4">
          <div className="inline-flex items-center rounded-full bg-black/40 p-1 ring-1 ring-white/10">
            <PillTab active={tab === 'screen'} onClick={() => setTab('screen')}>
              Screens <span className="text-white/40">({screens.length})</span>
            </PillTab>
            <PillTab active={tab === 'window'} onClick={() => setTab('window')}>
              Windows <span className="text-white/40">({windows.length})</span>
            </PillTab>
          </div>
        </div>

        {/* Grid */}
        <div className="flex-1 overflow-y-auto px-5 py-4">
          {loading ? (
            <div className="flex h-full items-center justify-center text-sm text-white/40">Loading sources…</div>
          ) : visible.length === 0 ? (
            <div className="flex h-full items-center justify-center text-sm text-white/40">No {tab}s available.</div>
          ) : (
            <div className={tab === 'screen' ? 'grid grid-cols-1 gap-4 sm:grid-cols-2' : 'grid grid-cols-2 gap-4 sm:grid-cols-3'}>
              {visible.map((s) => (
                <SourceCard
                  key={s.id}
                  source={s}
                  selected={selectedId === s.id}
                  onClick={() => setSelectedId(s.id)}
                />
              ))}
            </div>
          )}
        </div>

        {/* Action row */}
        <div className="flex items-center justify-end gap-2 border-t border-white/5 px-4 py-3">
          <button
            onClick={() => window.api.cancelSourcePicker()}
            className="rounded-full px-5 py-2 text-sm text-white/80 hover:bg-white/5"
          >
            Cancel
          </button>
          <button
            onClick={handleShare}
            disabled={!selected}
            className={
              'rounded-full px-6 py-2 text-sm font-medium transition ' +
              (selected
                ? 'bg-emerald-500 text-black hover:bg-emerald-400'
                : 'bg-white/10 text-white/30 cursor-not-allowed')
            }
          >
            Share
          </button>
        </div>
      </div>
    </div>
  );
}

function PillTab({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={
        'rounded-full px-5 py-1.5 text-sm font-medium transition ' +
        (active ? 'bg-white text-black shadow-sm' : 'text-white/60 hover:text-white/80')
      }
    >
      {children}
    </button>
  );
}

function SourceCard({
  source,
  selected,
  onClick
}: {
  source: DesktopSource;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={
        'group relative flex flex-col overflow-hidden rounded-xl border-2 bg-black/30 p-2 text-left transition ' +
        (selected
          ? 'border-emerald-400 ring-2 ring-emerald-400/30'
          : 'border-transparent hover:border-white/15')
      }
      aria-pressed={selected}
    >
      <div className="aspect-video w-full overflow-hidden rounded-lg bg-black">
        <img src={source.thumbnailDataUrl} alt={source.name} className="h-full w-full object-contain" />
      </div>
      <div className="mt-2 truncate px-1 text-xs text-white/80">{source.name}</div>
      {selected && (
        <span className="absolute right-3 top-3 flex h-7 w-7 items-center justify-center rounded-full bg-emerald-400 text-black shadow-lg">
          <Check size={16} strokeWidth={3} />
        </span>
      )}
    </button>
  );
}
