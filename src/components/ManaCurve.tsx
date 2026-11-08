import { useMemo, useState } from 'react';
import { AlertTriangle, BarChart3, ChevronDown, Sparkles } from 'lucide-react';
import type { DeckCard } from '../types';
import { calculateDeckStats } from '../utils/deckStats';

interface ManaCurveProps {
  cards: DeckCard[];
  commanderCardId?: string;
  isCommanderDeck?: boolean;
  symbols: Map<string, string>;
  onPlaytestClick?: () => void;
  onArenaExportClick?: () => void;
}

export function ManaCurve({
  cards,
  commanderCardId,
  isCommanderDeck,
  symbols,
  onPlaytestClick,
  onArenaExportClick,
}: ManaCurveProps) {
  const [isOpen, setIsOpen] = useState(false);

  const stats = useMemo(
    () => calculateDeckStats(cards, commanderCardId, isCommanderDeck),
    [cards, commanderCardId, isCommanderDeck],
  );

  if (cards.length === 0) return null;

  const hasWarnings = stats.commanderViolations.length > 0 || stats.duplicateViolations.length > 0;

  return (
    <div className="mb-4 rounded-xl border border-slate-800 bg-slate-950/70 p-3 transition">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <button
          type="button"
          onClick={() => setIsOpen((prev) => !prev)}
          className="flex items-center gap-2 text-left text-sm font-semibold text-white hover:text-violet-300"
          aria-expanded={isOpen}
        >
          <BarChart3 size={17} className="text-violet-400" />
          <span>Pakan tilastot & manakäyrä</span>
          <span className="text-xs font-normal text-slate-400">
            (Avg CMC: {stats.avgCmcWithoutLands} · {stats.landCount} maata · {stats.nonLandCount} loitsua)
          </span>
          <ChevronDown
            size={16}
            className={`text-slate-400 transition-transform ${isOpen ? 'rotate-180' : ''}`}
          />
        </button>

        <div className="flex flex-wrap items-center gap-2">
          {stats.totalPriceEur > 0 && (
            <span
              title={`Arvioitu arvo Cardmarket-hintojen mukaan (${stats.unpricedCount > 0 ? `${stats.unpricedCount} kortilta puuttuu hinta` : 'kaikki hinnat löydetty'})`}
              className="inline-flex items-center gap-1 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-1 text-xs font-medium text-emerald-300"
            >
              ~{stats.totalPriceEur.toFixed(2)} €
            </span>
          )}

          {hasWarnings && (
            <span
              title="Pakassa on Commander-sääntöhuomautuksia"
              className="inline-flex items-center gap-1 rounded-full border border-amber-500/40 bg-amber-500/15 px-2 py-0.5 text-xs font-medium text-amber-300"
            >
              <AlertTriangle size={13} />
              Huomioita
            </span>
          )}

          {onPlaytestClick && (
            <button
              type="button"
              onClick={onPlaytestClick}
              className="inline-flex items-center gap-1.5 rounded-lg border border-violet-500/40 bg-violet-500/10 px-2.5 py-1.5 text-xs font-medium text-violet-200 hover:bg-violet-500/20"
            >
              <Sparkles size={14} />
              Testaa pakkaa
            </button>
          )}

          {onArenaExportClick && (
            <button
              type="button"
              onClick={onArenaExportClick}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-900 px-2.5 py-1.5 text-xs font-medium text-slate-300 hover:bg-slate-800 hover:text-white"
            >
              Kopioi Arenaan
            </button>
          )}
        </div>
      </div>

      {isOpen && (
        <div className="mt-4 space-y-4 border-t border-slate-800/80 pt-4 text-xs">
          {/* Commander Warnings */}
          {hasWarnings && (
            <div className="rounded-lg border border-amber-500/30 bg-amber-950/30 p-3 text-amber-200">
              <div className="flex items-center gap-2 font-semibold">
                <AlertTriangle size={15} />
                <span>Commander-sääntöhuomautukset:</span>
              </div>
              <ul className="mt-1 list-inside list-disc space-y-0.5 text-[11px] text-amber-300/90">
                {stats.commanderViolations.map((v, i) => (
                  <li key={`color-${i}`}>{v}</li>
                ))}
                {stats.duplicateViolations.map((v, i) => (
                  <li key={`dup-${i}`}>{v}</li>
                ))}
              </ul>
            </div>
          )}

          <div className="grid gap-4 md:grid-cols-2">
            {/* Mana Curve Chart */}
            <div className="rounded-xl border border-slate-800 bg-[#0c1017] p-3">
              <div className="mb-2 flex items-center justify-between">
                <span className="font-semibold text-slate-300">Manakäyrä (ei-maat)</span>
                <span className="text-[11px] text-slate-500">Kesk. arvo: {stats.avgCmcWithoutLands}</span>
              </div>
              <div className="flex h-28 items-end gap-1.5 pt-4">
                {stats.curve.map((bucket) => {
                  const heightPercent = stats.maxCurveCount > 0 ? (bucket.count / stats.maxCurveCount) * 100 : 0;
                  return (
                    <div key={bucket.cmc} className="flex flex-1 flex-col items-center h-full justify-end">
                      <span className="mb-1 text-[10px] font-medium text-slate-400">
                        {bucket.count > 0 ? bucket.count : ''}
                      </span>
                      <div
                        style={{ height: `${Math.max(heightPercent, bucket.count > 0 ? 6 : 2)}%` }}
                        className={`w-full rounded-t transition-all ${
                          bucket.count > 0 ? 'bg-gradient-to-t from-violet-600 to-violet-400' : 'bg-slate-800/40'
                        }`}
                      />
                      <span className="mt-1.5 border-t border-slate-800 pt-1 text-[10px] font-semibold text-slate-400">
                        {bucket.label}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Color Distribution & Types */}
            <div className="space-y-3">
              {/* Types */}
              <div className="rounded-xl border border-slate-800 bg-[#0c1017] p-3">
                <div className="mb-2 font-semibold text-slate-300">Korttityypit</div>
                <div className="flex flex-wrap gap-1.5">
                  {stats.types.map((t) => (
                    <span
                      key={t.category}
                      className="inline-flex items-center gap-1.5 rounded-md border border-slate-800 bg-slate-900/80 px-2 py-1 text-[11px] text-slate-300"
                    >
                      <span className="font-medium text-white">{t.category}</span>
                      <span className="rounded bg-slate-800 px-1 text-[10px] text-violet-300 font-semibold">{t.count}</span>
                    </span>
                  ))}
                </div>
              </div>

              {/* Mana Pips */}
              {stats.colors.length > 0 && (
                <div className="rounded-xl border border-slate-800 bg-[#0c1017] p-3">
                  <div className="mb-2 font-semibold text-slate-300">Manasymbolit korteissa</div>
                  <div className="flex flex-wrap gap-2">
                    {stats.colors.map((c) => {
                      const symUrl = symbols.get(c.symbol);
                      return (
                        <span
                          key={c.color}
                          className="inline-flex items-center gap-1.5 rounded-lg border border-slate-800 bg-slate-900 px-2 py-1 text-slate-300"
                        >
                          {symUrl ? (
                            <img src={symUrl} alt={c.symbol} className="h-3.5 w-3.5" />
                          ) : (
                            <span className="text-[10px] font-bold">{c.color}</span>
                          )}
                          <span className="font-semibold text-white">{c.count} kpl</span>
                        </span>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
