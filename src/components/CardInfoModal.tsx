import { ExternalLink, X } from 'lucide-react';
import type { DeckCard, MtgCard } from '../types';
import type { CardRuling } from '../services/scryfall';

interface CardInfoModalProps {
  entry: DeckCard;
  cardRulings: CardRuling[];
  cardRulingsLoading: boolean;
  cardRulingsError: string | null;
  onClose: () => void;
  renderManaCost: (card: MtgCard) => React.ReactNode;
}

export function CardInfoModal({
  entry,
  cardRulings,
  cardRulingsLoading,
  cardRulingsError,
  onClose,
  renderManaCost,
}: CardInfoModalProps) {
  const card = entry.card;

  return (
    <div
      className="fixed inset-0 z-[65] flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm"
      role="presentation"
      onClick={onClose}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="card-info-title"
        className="flex max-h-[88dvh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-slate-700 bg-[#10141d] shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="flex items-start justify-between gap-4 border-b border-slate-800 p-4">
          <div className="min-w-0">
            <h2 id="card-info-title" className="truncate text-lg font-semibold text-white">
              {card.name}
            </h2>
            <p className="mt-1 text-sm text-slate-400">{card.type_line}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Sulje kortin tiedot"
            className="rounded-lg bg-slate-800 p-2 text-slate-200 hover:bg-slate-700"
          >
            <X size={18} />
          </button>
        </header>

        <div className="min-h-0 space-y-4 overflow-y-auto p-4">
          <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
            <div>
              <dt className="text-xs text-slate-500">Painos</dt>
              <dd className="mt-1 text-slate-200">{card.set_name ?? card.set.toUpperCase()}</dd>
            </div>
            <div>
              <dt className="text-xs text-slate-500">Keräilynumero</dt>
              <dd className="mt-1 text-slate-200">#{card.collector_number}</dd>
            </div>
            <div>
              <dt className="text-xs text-slate-500">Harvinaisuus</dt>
              <dd className="mt-1 capitalize text-slate-200">{card.rarity}</dd>
            </div>
            <div>
              <dt className="text-xs text-slate-500">Hinta-arvio</dt>
              <dd className="mt-1 font-medium text-emerald-400">
                {card.prices?.eur ? `${card.prices.eur} €` : card.prices?.usd ? `$${card.prices.usd}` : '–'}
              </dd>
            </div>
            {card.released_at && (
              <div>
                <dt className="text-xs text-slate-500">Julkaistu</dt>
                <dd className="mt-1 text-slate-200">{card.released_at}</dd>
              </div>
            )}
            {card.artist && (
              <div>
                <dt className="text-xs text-slate-500">Kuvittaja</dt>
                <dd className="mt-1 text-slate-200">{card.artist}</dd>
              </div>
            )}
          </dl>

          {(card.card_faces ?? []).map((face, index) => (
            <div key={`${face.name}-${index}`} className="rounded-xl border border-slate-800 bg-slate-950/70 p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="font-medium text-white">{face.name}</h3>
                {face.mana_cost && renderManaCost({ ...card, selected_face_index: index })}
              </div>
              {face.type_line && <p className="mt-1 text-xs text-slate-400">{face.type_line}</p>}
              {face.oracle_text && (
                <p className="mt-2 whitespace-pre-line text-sm leading-relaxed text-slate-300">{face.oracle_text}</p>
              )}
            </div>
          ))}

          {!(card.card_faces?.length) && card.oracle_text && (
            <p className="whitespace-pre-line rounded-xl border border-slate-800 bg-slate-950/70 p-3 text-sm leading-relaxed text-slate-300">
              {card.oracle_text}
            </p>
          )}

          {card.flavor_text && (
            <blockquote className="border-l-2 border-violet-500 pl-3 text-sm italic text-slate-400">
              {card.flavor_text}
            </blockquote>
          )}

          <section>
            <h3 className="font-semibold text-white">Sääntöhuomiot</h3>
            {cardRulingsLoading && <p className="mt-2 text-sm text-slate-400">Haetaan Scryfallista…</p>}
            {cardRulingsError && <p role="alert" className="mt-2 text-sm text-amber-300">{cardRulingsError}</p>}
            {!cardRulingsLoading && !cardRulingsError && cardRulings.length === 0 && (
              <p className="mt-2 text-sm text-slate-400">Kortille ei löytynyt erillisiä sääntöhuomioita.</p>
            )}
            <div className="mt-2 space-y-2">
              {cardRulings.map((ruling, index) => (
                <article key={`${ruling.published_at}-${index}`} className="rounded-lg border border-slate-800 bg-slate-950/70 p-3">
                  <div className="mb-1 flex flex-wrap justify-between gap-2 text-xs text-slate-500">
                    <span>{ruling.source}</span>
                    <span>{ruling.published_at}</span>
                  </div>
                  <p className="text-sm leading-relaxed text-slate-300">{ruling.comment}</p>
                </article>
              ))}
            </div>
          </section>
        </div>

        {card.scryfall_uri && (
          <footer className="border-t border-slate-800 p-4">
            <a
              href={card.scryfall_uri}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-2 text-sm font-medium text-violet-300 hover:text-violet-200"
            >
              <ExternalLink size={15} />
              Avaa kortti Scryfallissa
            </a>
          </footer>
        )}
      </section>
    </div>
  );
}
