import { useState } from 'react';
import { ArrowDownCircle, Check, Loader2, RefreshCw, Trash2, X } from 'lucide-react';
import type { ParsedDeckEntry } from '../utils/decklist';

interface CollectionImportModalProps {
  fileName: string;
  entries: ParsedDeckEntry[];
  isLoading: boolean;
  progress: { current: number; total: number } | null;
  onClose: () => void;
  onConfirm: (mode: 'sync' | 'add' | 'replace') => void;
}

export function CollectionImportModal({
  fileName,
  entries,
  isLoading,
  progress,
  onClose,
  onConfirm,
}: CollectionImportModalProps) {
  const [selectedMode, setSelectedMode] = useState<'sync' | 'add' | 'replace'>('sync');

  const totalCardCount = entries.reduce((sum, e) => sum + e.count, 0);

  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm"
      role="presentation"
      onClick={!isLoading ? onClose : undefined}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="collection-import-title"
        className="w-full max-w-lg rounded-2xl border border-slate-700 bg-[#10141d] p-5 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <h2 id="collection-import-title" className="text-lg font-semibold text-white">
              Tuo kokoelma – JSON / ManaBox / CSV
            </h2>
            <p className="mt-0.5 text-xs text-slate-400">
              Tiedosto: <span className="text-slate-200 font-medium">{fileName}</span>
            </p>
          </div>
          {!isLoading && (
            <button
              type="button"
              onClick={onClose}
              aria-label="Sulje"
              className="rounded-lg bg-slate-800 p-2 text-slate-200 hover:bg-slate-700"
            >
              <X size={18} />
            </button>
          )}
        </div>

        <div className="rounded-xl border border-slate-800 bg-slate-950/70 p-3 mb-4 text-xs text-slate-300">
          <p className="font-medium text-white">
            Tiedostosta tunnistettiin <span className="text-violet-300 font-semibold">{entries.length} eri korttiriviä</span> (yhteensä <span className="text-violet-300 font-semibold">{totalCardCount} kpl</span>).
          </p>
          <p className="mt-1 text-slate-400">
            Valitse, miten tiedoston kortit tuodaan nykyiseen kokoelmaasi:
          </p>
        </div>

        {isLoading ? (
          <div className="py-8 text-center space-y-3">
            <Loader2 size={32} className="mx-auto animate-spin text-violet-400" />
            <p className="text-sm font-medium text-white">Haetaan kortteja Scryfallista…</p>
            {progress && (
              <p className="text-xs text-slate-400">
                Käsitelty {progress.current} / {progress.total} tunnistetta
              </p>
            )}
            <p className="text-[11px] text-slate-500">Tämä saattaa kestää hetken riippuen korttien määrästä.</p>
          </div>
        ) : (
          <div className="space-y-2 mb-5">
            {/* Mode 1: Sync / Supplement */}
            <label
              className={`flex cursor-pointer items-start gap-3 rounded-xl border p-3 transition ${
                selectedMode === 'sync'
                  ? 'border-violet-500 bg-violet-500/15 ring-1 ring-violet-500'
                  : 'border-slate-800 bg-slate-900/60 hover:border-slate-700'
              }`}
            >
              <input
                type="radio"
                name="importMode"
                value="sync"
                checked={selectedMode === 'sync'}
                onChange={() => setSelectedMode('sync')}
                className="mt-1 text-violet-500 focus:ring-violet-400"
              />
              <div className="flex-1">
                <div className="flex items-center gap-1.5 font-medium text-white text-sm">
                  <RefreshCw size={14} className="text-violet-400" />
                  <span>Täydennä ja synkronoi (Suositeltu)</span>
                </div>
                <p className="mt-1 text-xs text-slate-400">
                  Päivittää kokoelmasi korttimäärät vastaamaan tuotua tiedostoa ja lisää puuttuvat kortit uutena. Olemassa olevia muita korttejasi ei poisteta.
                </p>
              </div>
            </label>

            {/* Mode 2: Add quantities */}
            <label
              className={`flex cursor-pointer items-start gap-3 rounded-xl border p-3 transition ${
                selectedMode === 'add'
                  ? 'border-violet-500 bg-violet-500/15 ring-1 ring-violet-500'
                  : 'border-slate-800 bg-slate-900/60 hover:border-slate-700'
              }`}
            >
              <input
                type="radio"
                name="importMode"
                value="add"
                checked={selectedMode === 'add'}
                onChange={() => setSelectedMode('add')}
                className="mt-1 text-violet-500 focus:ring-violet-400"
              />
              <div className="flex-1">
                <div className="flex items-center gap-1.5 font-medium text-white text-sm">
                  <ArrowDownCircle size={14} className="text-emerald-400" />
                  <span>Yhdistä (+määrät)</span>
                </div>
                <p className="mt-1 text-xs text-slate-400">
                  Lisää tiedoston kappalemäärät nykyisiin määriin (esim. jos sinulla on 1 kpl ja tiedostossa 2 kpl, uudeksi määräksi tulee 3 kpl).
                </p>
              </div>
            </label>

            {/* Mode 3: Replace */}
            <label
              className={`flex cursor-pointer items-start gap-3 rounded-xl border p-3 transition ${
                selectedMode === 'replace'
                  ? 'border-violet-500 bg-violet-500/15 ring-1 ring-violet-500'
                  : 'border-slate-800 bg-slate-900/60 hover:border-slate-700'
              }`}
            >
              <input
                type="radio"
                name="importMode"
                value="replace"
                checked={selectedMode === 'replace'}
                onChange={() => setSelectedMode('replace')}
                className="mt-1 text-violet-500 focus:ring-violet-400"
              />
              <div className="flex-1">
                <div className="flex items-center gap-1.5 font-medium text-white text-sm">
                  <Trash2 size={14} className="text-rose-400" />
                  <span>Korvaa kokoelma</span>
                </div>
                <p className="mt-1 text-xs text-slate-400">
                  Tyhjentää vanhan kokoelman kokonaan ja korvaa sen tuodulla tiedostolla.
                </p>
              </div>
            </label>
          </div>
        )}

        {!isLoading && (
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-slate-700 bg-slate-900 px-4 py-2 text-sm text-slate-300 hover:bg-slate-800"
            >
              Peruuta
            </button>
            <button
              type="button"
              onClick={() => onConfirm(selectedMode)}
              className="inline-flex items-center gap-2 rounded-lg bg-violet-500 px-4 py-2 text-sm font-medium text-white hover:bg-violet-400"
            >
              <Check size={16} />
              Aloita tuonti
            </button>
          </div>
        )}
      </section>
    </div>
  );
}
