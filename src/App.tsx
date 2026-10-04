import { useEffect, useState } from 'react';
import {
  ArrowUpDown,
  Download,
  FolderPlus,
  Library,
  Minus,
  Plus,
  Search,
  Trash2,
  Upload,
} from 'lucide-react';
import { db, exportAllData, importAllData } from './db';
import { fetchCardsBatch, getCardImageUrl, searchCards } from './services/scryfall';
import type { CollectionCard, Deck, MtgCard } from './types';
import { parseCsvImport, parseDecklistText, type ParsedDeckEntry } from './utils/decklist';

const tabs = [
  { id: 'decks', label: 'Paketit' },
  { id: 'collection', label: 'Kokoelma' },
  { id: 'search', label: 'Korttihaku' },
  { id: 'import', label: 'Tuo / Vie' },
] as const;

function App() {
  const [tab, setTab] = useState<(typeof tabs)[number]['id']>('decks');
  const [decks, setDecks] = useState<Deck[]>([]);
  const [collection, setCollection] = useState<CollectionCard[]>([]);
  const [selectedDeckId, setSelectedDeckId] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [searchResults, setSearchResults] = useState<MtgCard[]>([]);
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState('Valmis');
  const [importText, setImportText] = useState('');
  const [previewEntries, setPreviewEntries] = useState<ParsedDeckEntry[]>([]);

  const selectedDeck = decks.find((deck) => deck.id === selectedDeckId) ?? null;
  const deckTotal = selectedDeck?.cards.reduce((sum, card) => sum + card.count, 0) ?? 0;
  const collectionTotal = collection.reduce((sum, item) => sum + item.count, 0);

  const refreshDecks = async () => {
    const items = await db.decks.orderBy('updatedAt').reverse().toArray();
    setDecks(items);
    if (!selectedDeckId && items.length > 0) {
      setSelectedDeckId(items[0].id);
    }
    if (selectedDeckId && !items.some((deck) => deck.id === selectedDeckId) && items.length > 0) {
      setSelectedDeckId(items[0].id);
    }
  };

  const refreshCollection = async () => {
    const items = await db.collection.orderBy('addedAt').reverse().toArray();
    setCollection(items);
  };

  useEffect(() => {
    void refreshDecks();
    void refreshCollection();
  }, []);

  useEffect(() => {
    const trimmed = searchTerm.trim();
    if (trimmed.length < 2) {
      setSearchResults([]);
      return;
    }

    const timer = window.setTimeout(async () => {
      try {
        setLoading(true);
        const results = await searchCards(trimmed, 1);
        setSearchResults(results.cards.slice(0, 12));
        setStatus(`Löytyi ${results.totalCards} korttia`);
      } catch (error) {
        setStatus('Korttien haku epäonnistui');
        console.error(error);
      } finally {
        setLoading(false);
      }
    }, 250);

    return () => window.clearTimeout(timer);
  }, [searchTerm]);

  const createDeck = async () => {
    const deck: Deck = {
      id: crypto.randomUUID(),
      name: `Pakka ${decks.length + 1}`,
      cards: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    await db.decks.put(deck);
    setSelectedDeckId(deck.id);
    await refreshDecks();
    setStatus('Uusi pakka luotu');
  };

  const updateDeck = async (deck: Deck) => {
    const nextDeck = {
      ...deck,
      updatedAt: Date.now(),
    };
    await db.decks.put(nextDeck);
    await refreshDecks();
    return nextDeck;
  };

  const addCardToDeck = async (card: MtgCard, count = 1) => {
    if (!selectedDeckId) {
      setStatus('Luo ensin pakka');
      return;
    }

    const deck = decks.find((item) => item.id === selectedDeckId);
    if (!deck) return;

    const nextCards = [...deck.cards];
    const existingIndex = nextCards.findIndex((entry) => entry.cardId === card.id);

    if (existingIndex >= 0) {
      nextCards[existingIndex] = {
        ...nextCards[existingIndex],
        count: Math.max(0, nextCards[existingIndex].count + count),
      };
      if (nextCards[existingIndex].count === 0) {
        nextCards.splice(existingIndex, 1);
      }
    } else if (count > 0) {
      nextCards.push({ cardId: card.id, card, count, isSideboard: false });
    }

    const updatedDeck = { ...deck, cards: nextCards };
    await updateDeck(updatedDeck);
    setStatus(`${card.name} päivitetty pakkaan`);
  };

  const updateCollectionCard = async (card: MtgCard, change: number) => {
    const existing = await db.collection.get(card.id);
    const count = (existing?.count ?? 0) + change;

    if (count <= 0) {
      await db.collection.delete(card.id);
    } else {
      await db.collection.put({
        id: card.id,
        card,
        count,
        addedAt: existing?.addedAt ?? Date.now(),
      });
    }

    await refreshCollection();
    setStatus(count > 0 ? `${card.name} päivitetty kokoelmaan` : `${card.name} poistettu kokoelmasta`);
  };

  const removeDeck = async (deckId: string) => {
    await db.decks.delete(deckId);
    await refreshDecks();
    setStatus('Pakka poistettu');
  };

  const handleImportPreview = (text: string, kind: 'decklist' | 'csv') => {
    const parsed = kind === 'decklist' ? parseDecklistText(text) : parseCsvImport(text);
    setPreviewEntries(parsed);
    setStatus(`${parsed.length} korttia esikatselussa`);
  };

  const applyImportedEntries = async (entries: ParsedDeckEntry[]) => {
    if (!entries.length) {
      setStatus('Ei kortteja tuoda');
      return;
    }
    if (!selectedDeckId) {
      setStatus('Luo ensin pakka');
      return;
    }

    const deck = decks.find((item) => item.id === selectedDeckId);
    if (!deck) return;

    const { found } = await fetchCardsBatch(entries.map((entry) => ({ name: entry.name })));
    const foundByName = new Map<string, MtgCard>();
    for (const card of found) {
      foundByName.set(card.name.toLowerCase(), card);
    }

    const nextCards = [...deck.cards];
    for (const entry of entries) {
      const card = foundByName.get(entry.name.toLowerCase());
      if (!card) continue;
      const existingIndex = nextCards.findIndex((item) => item.cardId === card.id);
      if (existingIndex >= 0) {
        nextCards[existingIndex] = {
          ...nextCards[existingIndex],
          count: nextCards[existingIndex].count + entry.count,
        };
      } else {
        nextCards.push({ cardId: card.id, card, count: entry.count, isSideboard: false });
      }
    }

    await updateDeck({ ...deck, cards: nextCards });
    setStatus(`Tuotiin ${entries.length} korttia pakkaan`);
  };

  const handleExport = async () => {
    const payload = await exportAllData();
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'mtg-vault-export.json';
    link.click();
    URL.revokeObjectURL(url);
    setStatus('Vienti valmis');
  };

  const handleFileImport = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    try {
      const raw = await file.text();

      if (file.name.toLowerCase().endsWith('.json')) {
        const parsed = JSON.parse(raw) as { decks?: Deck[]; collection?: unknown[] };
        if (!parsed || (!parsed.decks && !parsed.collection)) {
          throw new Error('Virheellinen JSON');
        }
        await importAllData({
          version: 1,
          exportedAt: Date.now(),
          decks: parsed.decks ?? [],
          collection: (parsed.collection ?? []) as any,
        }, 'merge');
        await refreshDecks();
        await refreshCollection();
        setStatus('Import onnistui');
      } else {
        const parsed = file.name.toLowerCase().endsWith('.csv') ? parseCsvImport(raw) : parseDecklistText(raw);
        setPreviewEntries(parsed);
        if (parsed.length) {
          await applyImportedEntries(parsed);
        } else {
          setStatus('Tiedostosta ei löytynyt kortteja');
        }
      }
    } catch (error) {
      console.error(error);
      setStatus('Tiedoston import epäonnistui');
    } finally {
      event.target.value = '';
    }
  };

  return (
    <div className="min-h-screen bg-[#0b0c10] text-slate-100">
      <header className="border-b border-slate-800 bg-[#0f1117] sticky top-0 z-20 backdrop-blur-sm">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3 sm:px-6">
          <div>
            <p className="text-[10px] uppercase tracking-[0.25em] text-violet-400">EZ MTG</p>
            <h1 className="text-xl font-semibold text-white">MTG companion app</h1>
          </div>
          <button
            type="button"
            onClick={createDeck}
            className="inline-flex items-center gap-2 rounded-lg bg-violet-500 px-3 py-2 text-sm font-medium text-white shadow-lg shadow-violet-500/20 transition hover:bg-violet-400"
          >
            <FolderPlus size={16} />
            Uusi pakka
          </button>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 py-6 sm:px-6">
        <div className="mb-6 flex flex-wrap gap-2 rounded-xl border border-slate-800 bg-[#121722] p-2">
          {tabs.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => setTab(item.id)}
              className={`rounded-lg px-3 py-2 text-sm font-medium transition ${
                tab === item.id
                  ? 'bg-violet-500 text-white shadow-lg shadow-violet-500/20'
                  : 'bg-slate-900 text-slate-300 hover:bg-slate-800'
              }`}
            >
              {item.label}
            </button>
          ))}
        </div>

        {tab === 'decks' && (
          <div className="grid gap-6 lg:grid-cols-[280px_1fr]">
            <aside className="rounded-2xl border border-slate-800 bg-[#10141d] p-3">
              <div className="mb-3 flex items-center justify-between">
                <h2 className="text-sm font-semibold uppercase tracking-[0.2em] text-slate-400">Paketit</h2>
                <span className="rounded-full bg-slate-800 px-2 py-1 text-xs text-slate-300">{decks.length}</span>
              </div>

              <div className="space-y-2">
                {decks.length === 0 && <p className="text-sm text-slate-400">Ei pakkoja vielä.</p>}
                {decks.map((deck) => (
                  <div
                    key={deck.id}
                    className={`flex items-center justify-between rounded-xl border px-3 py-2 text-left transition ${
                      selectedDeckId === deck.id
                        ? 'border-violet-500 bg-violet-500/10'
                        : 'border-slate-800 bg-slate-900/60 hover:border-slate-700'
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => setSelectedDeckId(deck.id)}
                      className="flex flex-1 items-center justify-between text-left"
                    >
                      <div>
                        <div className="font-medium text-white">{deck.name}</div>
                        <div className="text-xs text-slate-400">{deck.cards.reduce((sum, item) => sum + item.count, 0)} korttia</div>
                      </div>
                    </button>
                    <button
                      type="button"
                      onClick={() => void removeDeck(deck.id)}
                      className="ml-2 rounded-md p-1 text-slate-400 hover:bg-slate-800 hover:text-red-300"
                      aria-label={`Poista ${deck.name}`}
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                ))}
              </div>
            </aside>

            <section className="rounded-2xl border border-slate-800 bg-[#111827] p-4">
              {selectedDeck ? (
                <>
                  <div className="mb-4 flex flex-col gap-3 border-b border-slate-800 pb-4 md:flex-row md:items-center md:justify-between">
                    <div>
                      <div className="text-xs uppercase tracking-[0.25em] text-slate-400">Valittu pakka</div>
                      <h2 className="mt-1 text-2xl font-semibold text-white">{selectedDeck.name}</h2>
                    </div>
                    <div className="rounded-full border border-violet-500/50 bg-violet-500/10 px-3 py-1 text-sm text-violet-200">
                      {deckTotal} korttia
                    </div>
                  </div>

                  <div className="space-y-3">
                    {selectedDeck.cards.length === 0 && <p className="text-slate-400">Pakka on tyhjä. Hae kortteja ja lisää ne pakkaan.</p>}
                    {selectedDeck.cards.map((entry) => {
                      const imageUrl = getCardImageUrl(entry.card, 'small');
                      return (
                        <div key={entry.cardId} className="flex items-center gap-3 rounded-xl border border-slate-800 bg-slate-950/80 p-2">
                          <img
                            src={imageUrl ?? 'https://placehold.co/80x112/111827/9ca3af?text=MTG'}
                            alt={entry.card.name}
                            className="h-16 w-12 rounded-md object-cover"
                          />

                          <div className="min-w-0 flex-1">
                            <div className="truncate font-medium text-white">{entry.card.name}</div>
                            <div className="text-xs text-slate-400">{entry.card.type_line}</div>
                          </div>

                          <div className="flex items-center gap-2">
                            <button
                              type="button"
                              onClick={() => void addCardToDeck(entry.card, -1)}
                              className="rounded-md bg-slate-800 p-2 text-slate-200 hover:bg-slate-700"
                              aria-label={`Vähennä ${entry.card.name}`}
                            >
                              <Minus size={14} />
                            </button>
                            <span className="min-w-6 text-center text-sm font-semibold text-white">{entry.count}</span>
                            <button
                              type="button"
                              onClick={() => void addCardToDeck(entry.card, 1)}
                              className="rounded-md bg-violet-500 p-2 text-white hover:bg-violet-400"
                              aria-label={`Lisää ${entry.card.name}`}
                            >
                              <Plus size={14} />
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </>
              ) : (
                <p className="text-slate-400">Valitse pakka.</p>
              )}
            </section>
          </div>
        )}

        {tab === 'search' && (
          <section className="rounded-2xl border border-slate-800 bg-[#10141d] p-4">
            <div className="mb-4 flex items-center gap-3 rounded-xl border border-slate-700 bg-slate-950/80 px-3 py-3">
              <Search size={18} className="text-slate-400" />
              <input
                value={searchTerm}
                onChange={(event) => setSearchTerm(event.target.value)}
                placeholder="Hae korttia, esim. Lightning Bolt..."
                className="w-full bg-transparent text-sm text-white placeholder:text-slate-500 focus:outline-none"
              />
            </div>

            {loading && <p className="mb-4 text-sm text-slate-400">Haetaan kortteja...</p>}

            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {searchResults.map((card) => {
                const imageUrl = getCardImageUrl(card, 'small');
                return (
                  <div key={card.id} className="rounded-xl border border-slate-800 bg-slate-950/80 p-3">
                    <div className="mb-3 flex items-center gap-3">
                      <img src={imageUrl ?? 'https://placehold.co/80x112/111827/9ca3af?text=MTG'} alt={card.name} className="h-16 w-12 rounded-md object-cover" />
                      <div className="min-w-0 flex-1">
                        <div className="truncate font-medium text-white">{card.name}</div>
                        <div className="text-xs text-slate-400">{card.set.toUpperCase()} · {card.rarity}</div>
                      </div>
                    </div>
                    <div className="mb-2 text-xs text-slate-400">{card.type_line}</div>
                    <div className="grid grid-cols-2 gap-2">
                      <button
                        type="button"
                        onClick={() => void addCardToDeck(card, 1)}
                        className="inline-flex items-center justify-center gap-2 rounded-lg bg-violet-500 px-3 py-2 text-sm font-medium text-white hover:bg-violet-400"
                      >
                        <Plus size={14} />
                        Lisää pakkaan
                      </button>
                      <button
                        type="button"
                        onClick={() => void updateCollectionCard(card, 1)}
                        className="inline-flex items-center justify-center gap-2 rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm font-medium text-slate-200 hover:bg-slate-800"
                      >
                        <Library size={14} />
                        Kokoelmaan
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        )}

        {tab === 'collection' && (
          <section className="rounded-2xl border border-slate-800 bg-[#10141d] p-4">
            <div className="mb-4 flex flex-col gap-2 border-b border-slate-800 pb-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h2 className="text-xl font-semibold text-white">Kokoelma</h2>
                <p className="text-sm text-slate-400">Kortit ja kappalemäärät tallentuvat tälle laitteelle.</p>
              </div>
              <span className="rounded-full border border-violet-500/50 bg-violet-500/10 px-3 py-1 text-sm text-violet-200">
                {collectionTotal} korttia · {collection.length} eri korttia
              </span>
            </div>

            <div className="space-y-3">
              {collection.length === 0 && (
                <p className="rounded-xl border border-dashed border-slate-700 p-6 text-center text-slate-400">
                  Kokoelma on tyhjä. Hae kortteja ja lisää ne kokoelmaan Korttihaku-välilehdeltä.
                </p>
              )}
              {collection.map((entry) => {
                const imageUrl = getCardImageUrl(entry.card, 'small');
                return (
                  <div key={entry.id} className="flex items-center gap-3 rounded-xl border border-slate-800 bg-slate-950/80 p-2">
                    <img
                      src={imageUrl ?? 'https://placehold.co/80x112/111827/9ca3af?text=MTG'}
                      alt={entry.card.name}
                      loading="lazy"
                      className="h-16 w-12 rounded-md object-cover"
                    />
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-medium text-white">{entry.card.name}</div>
                      <div className="text-xs text-slate-400">{entry.card.set.toUpperCase()} · {entry.card.type_line}</div>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => void updateCollectionCard(entry.card, -1)}
                        className="rounded-md bg-slate-800 p-2 text-slate-200 hover:bg-slate-700"
                        aria-label={`Vähennä ${entry.card.name} kokoelmasta`}
                      >
                        <Minus size={14} />
                      </button>
                      <span className="min-w-6 text-center text-sm font-semibold text-white">{entry.count}</span>
                      <button
                        type="button"
                        onClick={() => void updateCollectionCard(entry.card, 1)}
                        className="rounded-md bg-violet-500 p-2 text-white hover:bg-violet-400"
                        aria-label={`Lisää ${entry.card.name} kokoelmaan`}
                      >
                        <Plus size={14} />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        )}

        {tab === 'import' && (
          <section className="grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
            <div className="rounded-2xl border border-slate-800 bg-[#10141d] p-4">
              <h2 className="mb-3 text-lg font-semibold text-white">ManaBox tuonti</h2>
              <textarea
                value={importText}
                onChange={(event) => {
                  setImportText(event.target.value);
                  if (event.target.value.trim()) {
                    handleImportPreview(event.target.value, 'decklist');
                  }
                }}
                placeholder={'4 Lightning Bolt (M25) 141\n2 Counterspell\nSideboard\n2 Pyroblast'}
                className="min-h-[220px] w-full rounded-xl border border-slate-700 bg-slate-950/80 p-3 text-sm text-slate-100 placeholder:text-slate-500 focus:border-violet-500 focus:outline-none"
              />
              <div className="mt-3 flex flex-wrap gap-3">
                <button
                  type="button"
                  onClick={() => handleImportPreview(importText, 'decklist')}
                  className="inline-flex items-center gap-2 rounded-lg bg-violet-500 px-3 py-2 text-sm font-medium text-white hover:bg-violet-400"
                >
                  <ArrowUpDown size={16} />
                  Esikatsele
                </button>
                <button
                  type="button"
                  onClick={() => void applyImportedEntries(previewEntries)}
                  className="inline-flex items-center gap-2 rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm font-medium text-slate-200 hover:bg-slate-800"
                >
                  <Upload size={16} />
                  Lisää pakkaan
                </button>
                <button
                  type="button"
                  onClick={async () => {
                    const result = await fetchCardsBatch(previewEntries.map((entry) => ({ name: entry.name })));
                    const cardsByName = new Map(result.found.map((card) => [card.name.toLowerCase(), card]));
                    for (const entry of previewEntries) {
                      const card = cardsByName.get(entry.name.toLowerCase());
                      if (card) await updateCollectionCard(card, entry.count);
                    }
                  }}
                  className="inline-flex items-center gap-2 rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm font-medium text-slate-200 hover:bg-slate-800"
                >
                  <Library size={16} />
                  Lisää kokoelmaan
                </button>
              </div>

              <div className="mt-4">
                <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-200 hover:bg-slate-800">
                  <Upload size={16} />
                  CSV / JSON tiedosto
                  <input type="file" accept=".csv,.json,.txt" className="hidden" onChange={handleFileImport} />
                </label>
              </div>
            </div>

            <div className="rounded-2xl border border-slate-800 bg-[#10141d] p-4">
              <div className="mb-3 flex items-center justify-between">
                <h2 className="text-lg font-semibold text-white">Esikatselu</h2>
                <button
                  type="button"
                  onClick={handleExport}
                  className="inline-flex items-center gap-2 rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-200 hover:bg-slate-800"
                >
                  <Download size={16} />
                  Vie JSON
                </button>
              </div>

              <div className="max-h-[420px] space-y-2 overflow-auto rounded-xl bg-slate-950/80 p-3">
                {previewEntries.length === 0 ? (
                  <p className="text-sm text-slate-400">Ei esikatseltavia kortteja.</p>
                ) : (
                  previewEntries.map((entry, index) => (
                    <div key={`${entry.name}-${index}`} className="flex items-center justify-between rounded-lg border border-slate-800 px-2 py-2 text-sm">
                      <span className="text-slate-200">{entry.name}</span>
                      <span className="rounded-full bg-slate-800 px-2 py-1 text-xs text-slate-300">x{entry.count}</span>
                    </div>
                  ))
                )}
              </div>
            </div>
          </section>
        )}
      </main>

      <div className="border-t border-slate-800 bg-[#0d1017] px-4 py-3 text-center text-xs text-slate-400">
        {status}
      </div>
    </div>
  );
}

export default App;
