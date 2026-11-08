import { Library, Plus, X } from 'lucide-react';
import type { MtgCard } from '../types';
import { getCardImageUrl } from '../services/scryfall';

interface PrintingsModalProps {
  card: MtgCard;
  printings: MtgCard[];
  selectedPrinting: MtgCard | null;
  printingsLoading: boolean;
  printingsError: string | null;
  printingsHasMore: boolean;
  onClose: () => void;
  onSelectPrinting: (printing: MtgCard) => void;
  onPreviewPrinting: (printing: MtgCard) => void;
  onLoadMore: () => void;
  onAddToDeck: (printing: MtgCard) => void;
  onAddToCollection: (printing: MtgCard) => void;
}

export function PrintingsModal({
  card,
  printings,
  selectedPrinting,
  printingsLoading,
  printingsError,
  printingsHasMore,
  onClose,
  onSelectPrinting,
  onPreviewPrinting,
  onLoadMore,
  onAddToDeck,
  onAddToCollection,
}: PrintingsModalProps) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 p-3 backdrop-blur-sm sm:p-6"
      role="presentation"
      onClick={onClose}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="printings-title"
        className="flex max-h-[92dvh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl border border-slate-700 bg-[#10141d] shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="flex items-start justify-between gap-4 border-b border-slate-800 p-4 sm:p-5">
          <div className="min-w-0">
            <h2 id="printings-title" className="truncate text-lg font-semibold text-white sm:text-xl">
              {card.name} – julkaisut
            </h2>
            <p className="mt-1 text-sm text-slate-400">Valitse haluamasi kuvitus ja painos.</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Sulje julkaisujen valinta"
            className="shrink-0 rounded-lg bg-slate-800 p-2 text-slate-200 hover:bg-slate-700"
          >
            <X size={20} />
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-5">
          {printingsError && (
            <p role="alert" className="mb-4 rounded-lg border border-red-900 bg-red-950/50 p-3 text-sm text-red-200">
              {printingsError}
            </p>
          )}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
            {printings.map((printing) => {
              const imageUrl = getCardImageUrl(printing, 'normal') ?? getCardImageUrl(printing, 'small');
              const isSelected = selectedPrinting?.id === printing.id;
              const eurPrice = printing.prices?.eur;
              return (
                <div
                  key={printing.id}
                  className={`rounded-xl border p-2 text-left transition ${
                    isSelected
                      ? 'border-violet-400 bg-violet-500/15 ring-1 ring-violet-400'
                      : 'border-slate-800 bg-slate-950/70 hover:border-slate-600'
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => {
                      onSelectPrinting(printing);
                      onPreviewPrinting(printing);
                    }}
                    aria-label={`Näytä ${printing.name}, ${printing.set_name ?? printing.set}, isompana`}
                    className="block w-full overflow-hidden rounded-lg focus:outline-none focus:ring-2 focus:ring-violet-400"
                  >
                    <img
                      src={imageUrl ?? 'https://placehold.co/488x680/111827/9ca3af?text=No+image'}
                      alt={`${printing.name}, ${printing.set_name ?? printing.set}`}
                      loading="lazy"
                      className="mx-auto aspect-[5/7] w-full rounded-lg object-cover"
                    />
                  </button>
                  <button
                    type="button"
                    onClick={() => onSelectPrinting(printing)}
                    aria-pressed={isSelected}
                    className="mt-2 block w-full text-left"
                  >
                    <div className="flex items-center justify-between gap-1">
                      <span className="block truncate text-sm font-medium text-white">
                        {printing.set_name ?? printing.set.toUpperCase()}
                      </span>
                      {eurPrice && (
                        <span className="shrink-0 text-xs font-semibold text-emerald-400">
                          {eurPrice} €
                        </span>
                      )}
                    </div>
                    <span className="block truncate text-xs text-slate-400">
                      {printing.set.toUpperCase()} · #{printing.collector_number}
                      {printing.lang ? ` · ${printing.lang.toUpperCase()}` : ''}
                    </span>
                  </button>
                </div>
              );
            })}
          </div>

          {printingsLoading && <p className="py-5 text-center text-sm text-slate-400">Haetaan julkaisuja…</p>}
          {!printingsLoading && !printingsError && printings.length === 0 && (
            <p className="py-5 text-center text-sm text-slate-400">Julkaisuja ei löytynyt.</p>
          )}
          {printingsHasMore && !printingsLoading && (
            <button
              type="button"
              onClick={onLoadMore}
              className="mx-auto mt-4 block rounded-lg border border-slate-700 bg-slate-900 px-4 py-2 text-sm text-slate-200 hover:bg-slate-800"
            >
              Lataa lisää julkaisuja
            </button>
          )}
        </div>

        <footer className="flex flex-col gap-2 border-t border-slate-800 p-4 sm:flex-row sm:justify-end sm:p-5">
          <button
            type="button"
            disabled={!selectedPrinting}
            onClick={() => selectedPrinting && onAddToDeck(selectedPrinting)}
            className="inline-flex items-center justify-center gap-2 rounded-lg bg-violet-500 px-4 py-2.5 text-sm font-medium text-white hover:bg-violet-400 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Plus size={16} />
            Lisää valittu pakkaan
          </button>
          <button
            type="button"
            disabled={!selectedPrinting}
            onClick={() => selectedPrinting && onAddToCollection(selectedPrinting)}
            className="inline-flex items-center justify-center gap-2 rounded-lg border border-slate-700 bg-slate-900 px-4 py-2.5 text-sm font-medium text-slate-200 hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Library size={16} />
            Lisää valittu kokoelmaan
          </button>
        </footer>
      </section>
    </div>
  );
}
