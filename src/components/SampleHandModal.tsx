import { useState } from 'react';
import { Play, RefreshCw, X } from 'lucide-react';
import type { DeckCard, MtgCard } from '../types';
import { getCardImageUrl } from '../services/scryfall';

interface SampleHandModalProps {
  deckName: string;
  cards: DeckCard[];
  onClose: () => void;
  onCardClick: (card: MtgCard) => void;
}

function createShuffledPool(cards: DeckCard[]): { hand: MtgCard[]; library: MtgCard[] } {
  const mainCards = cards.filter((c) => !c.isSideboard);
  const pool: MtgCard[] = [];
  for (const entry of mainCards) {
    for (let i = 0; i < entry.count; i++) {
      pool.push(entry.card);
    }
  }
  // Fisher-Yates shuffle
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return {
    hand: pool.slice(0, 7),
    library: pool.slice(7),
  };
}

export function SampleHandModal({
  deckName,
  cards,
  onClose,
  onCardClick,
}: SampleHandModalProps) {
  const [gameState, setGameState] = useState(() => createShuffledPool(cards));
  const [mulligans, setMulligans] = useState(0);

  const { hand, library } = gameState;

  const handleRestart = () => {
    setGameState(createShuffledPool(cards));
    setMulligans(0);
  };

  const handleMulligan = () => {
    setGameState(createShuffledPool(cards));
    setMulligans((prev) => prev + 1);
  };

  const handleDrawCard = () => {
    if (library.length === 0) return;
    const [nextCard, ...remainingLibrary] = library;
    setGameState((prev) => ({
      hand: [...prev.hand, nextCard],
      library: remainingLibrary,
    }));
  };

  return (
    <div
      className="fixed inset-0 z-[65] flex items-center justify-center bg-black/85 p-3 backdrop-blur-sm sm:p-5"
      role="presentation"
      onClick={onClose}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="sample-hand-title"
        className="flex max-h-[92dvh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl border border-slate-700 bg-[#10141d] shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800 p-4">
          <div>
            <h2 id="sample-hand-title" className="text-lg font-semibold text-white">
              Testaa pakkaa – {deckName}
            </h2>
            <p className="text-xs text-slate-400">
              Kädessä {hand.length} korttia · Kirjastossa {library.length} korttia
              {mulligans > 0 && ` · Mulligan #${mulligans}`}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={handleDrawCard}
              disabled={library.length === 0}
              className="inline-flex items-center gap-1.5 rounded-lg border border-violet-500/40 bg-violet-500/15 px-3 py-1.5 text-xs font-medium text-violet-200 hover:bg-violet-500/25 disabled:cursor-not-allowed disabled:opacity-40"
            >
              <Play size={13} />
              Nosta kortti
            </button>
            <button
              type="button"
              onClick={handleMulligan}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-900 px-3 py-1.5 text-xs font-medium text-slate-200 hover:bg-slate-800"
            >
              <RefreshCw size={13} />
              Mulligan
            </button>
            <button
              type="button"
              onClick={handleRestart}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-900 px-3 py-1.5 text-xs font-medium text-slate-200 hover:bg-slate-800"
            >
              Aloita alusta
            </button>
            <button
              type="button"
              onClick={onClose}
              aria-label="Sulje testaus"
              className="rounded-lg bg-slate-800 p-1.5 text-slate-300 hover:bg-slate-700 hover:text-white"
            >
              <X size={18} />
            </button>
          </div>
        </header>

        <div className="flex-1 overflow-y-auto p-4 sm:p-5">
          {hand.length === 0 ? (
            <p className="py-12 text-center text-sm text-slate-400">Käsi on tyhjä.</p>
          ) : (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-7">
              {hand.map((card, index) => {
                const imageUrl = getCardImageUrl(card, 'normal') ?? getCardImageUrl(card, 'small');
                return (
                  <button
                    key={`${card.id}-${index}`}
                    type="button"
                    onClick={() => onCardClick(card)}
                    className="group relative flex flex-col overflow-hidden rounded-xl border border-slate-800 bg-slate-950/80 p-1.5 text-left transition hover:border-violet-500 hover:scale-[1.02] focus:outline-none focus:ring-2 focus:ring-violet-400"
                  >
                    <img
                      src={imageUrl ?? 'https://placehold.co/488x680/111827/9ca3af?text=MTG'}
                      alt={card.name}
                      className="aspect-[5/7] w-full rounded-lg object-cover"
                    />
                    <span className="mt-1.5 truncate text-[11px] font-medium text-slate-200 group-hover:text-violet-300">
                      {card.name}
                    </span>
                    <span className="truncate text-[10px] text-slate-400">
                      {card.mana_cost || 'Maa / Ei kuluja'}
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
