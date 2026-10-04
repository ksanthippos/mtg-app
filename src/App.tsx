import { useEffect, useState } from 'react';
import {
  ArrowUpDown,
  Download,
  FolderPlus,
  Layers,
  Library,
  MoreHorizontal,
  Minus,
  Pencil,
  Plus,
  Save,
  Search,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import { db, exportAllData, importAllData } from './db';
import { fetchCardSymbolUris, fetchCardsBatch, getCardImageUrl, searchCardPrintings, searchCards } from './services/scryfall';
import type { CollectionCard, Deck, MtgCard } from './types';
import { parseCsvImport, parseDecklistText, type ParsedDeckEntry } from './utils/decklist';

const tabs = [
  { id: 'decks', label: 'Pakat' },
  { id: 'collection', label: 'Kokoelma' },
  { id: 'search', label: 'Korttihaku' },
  { id: 'import', label: 'Tuo / Vie' },
] as const;

function ManaText({ text, symbols }: { text: string; symbols: Map<string, string> }) {
  return text.split(/(\{[^}]+\})/g).map((part, index) => {
    const imageUrl = symbols.get(part);
    if (!imageUrl) return part;

    return (
      <img
        key={`${part}-${index}`}
        src={imageUrl}
        alt={part}
        title={part}
        className="mx-0.5 inline-block h-4 w-4 align-[-0.2em]"
      />
    );
  });
}

function App() {
  const [tab, setTab] = useState<(typeof tabs)[number]['id']>('decks');
  const [decks, setDecks] = useState<Deck[]>([]);
  const [collection, setCollection] = useState<CollectionCard[]>([]);
  const [dirtyDeckIds, setDirtyDeckIds] = useState<Set<string>>(() => new Set());
  const [dirtyCollectionIds, setDirtyCollectionIds] = useState<Set<string>>(() => new Set());
  const [openDeckMenuId, setOpenDeckMenuId] = useState<string | null>(null);
  const [deckNameDialog, setDeckNameDialog] = useState<{ mode: 'create' } | { mode: 'rename'; deckId: string } | null>(null);
  const [deckNameInput, setDeckNameInput] = useState('');
  const [selectedDeckId, setSelectedDeckId] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [searchResults, setSearchResults] = useState<MtgCard[]>([]);
  const [symbolUris, setSymbolUris] = useState<Map<string, string>>(() => new Map());
  const [previewCard, setPreviewCard] = useState<MtgCard | null>(null);
  const [printingCard, setPrintingCard] = useState<MtgCard | null>(null);
  const [printings, setPrintings] = useState<MtgCard[]>([]);
  const [selectedPrinting, setSelectedPrinting] = useState<MtgCard | null>(null);
  const [printingsPage, setPrintingsPage] = useState(1);
  const [printingsHasMore, setPrintingsHasMore] = useState(false);
  const [printingsLoading, setPrintingsLoading] = useState(false);
  const [printingsError, setPrintingsError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState('Valmis');
  const [toast, setToast] = useState<string | null>(null);
  const [pendingDeckCard, setPendingDeckCard] = useState<MtgCard | null>(null);
  const [importText, setImportText] = useState('');
  const [previewEntries, setPreviewEntries] = useState<ParsedDeckEntry[]>([]);

  const selectedDeck = decks.find((deck) => deck.id === selectedDeckId) ?? null;
  const deckTotal = selectedDeck?.cards.reduce((sum, card) => sum + card.count, 0) ?? 0;
  const collectionTotal = collection.reduce((sum, item) => sum + item.count, 0);

  useEffect(() => {
    if (!toast) return;
    const timeout = window.setTimeout(() => setToast(null), 3000);
    return () => window.clearTimeout(timeout);
  }, [toast]);

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
    fetchCardSymbolUris()
      .then(setSymbolUris)
      .catch((error: unknown) => {
        console.error('Virallisten korttisymbolien lataus epäonnistui:', error);
      });
  }, []);

  useEffect(() => {
    if (!previewCard && !printingCard && !pendingDeckCard && !deckNameDialog) return;

    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setPreviewCard(null);
        setPrintingCard(null);
        setPendingDeckCard(null);
        setDeckNameDialog(null);
      }
    };
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', closeOnEscape);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', closeOnEscape);
    };
  }, [previewCard, printingCard, pendingDeckCard, deckNameDialog]);

  useEffect(() => {
    if (!printingCard) return;

    let cancelled = false;
    setPrintingsLoading(true);
    setPrintingsError(null);

    searchCardPrintings(printingCard, printingsPage)
      .then((result) => {
        if (cancelled) return;
        setPrintings((current) => printingsPage === 1 ? result.cards : [...current, ...result.cards]);
        setPrintingsHasMore(result.hasMore);
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        console.error('Kortin julkaisujen haku epäonnistui:', error);
        setPrintingsError('Kortin julkaisuja ei voitu hakea. Tarkista verkkoyhteys ja yritä uudelleen.');
      })
      .finally(() => {
        if (!cancelled) setPrintingsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [printingCard, printingsPage]);

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
    const name = deckNameInput.trim();
    if (!name) {
      setStatus('Anna pakalle nimi.');
      return;
    }

    const deck: Deck = {
      id: crypto.randomUUID(),
      name,
      cards: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    await db.decks.put(deck);
    setSelectedDeckId(deck.id);
    setDecks((current) => [deck, ...current]);
    setDeckNameDialog(null);
    setDeckNameInput('');
    setStatus(`Pakka "${name}" luotu.`);
    setToast(`Pakka "${name}" luotu.`);
  };

  const openCreateDeckDialog = () => {
    setDeckNameInput('');
    setDeckNameDialog({ mode: 'create' });
  };

  const openRenameDeckDialog = (deck: Deck) => {
    setDeckNameInput(deck.name);
    setDeckNameDialog({ mode: 'rename', deckId: deck.id });
    setOpenDeckMenuId(null);
  };

  const saveDeckName = async () => {
    const name = deckNameInput.trim();
    if (!name) {
      setStatus('Pakan nimi ei voi olla tyhjä.');
      return;
    }

    if (deckNameDialog?.mode === 'create') {
      await createDeck();
      return;
    }

    if (deckNameDialog?.mode === 'rename') {
      const deck = decks.find((item) => item.id === deckNameDialog.deckId);
      if (!deck) {
        setStatus('Pakettia ei löytynyt.');
        setDeckNameDialog(null);
        return;
      }
      await updateDeck({ ...deck, name });
      setDeckNameDialog(null);
      setDeckNameInput('');
      setStatus(`Pakan nimeksi muutettu "${name}". Tallenna muutokset.`);
    }
  };

  const updateDeck = async (deck: Deck) => {
    const nextDeck = {
      ...deck,
      updatedAt: Date.now(),
    };
    setDecks((current) => current.map((item) => item.id === nextDeck.id ? nextDeck : item));
    setDirtyDeckIds((current) => new Set(current).add(nextDeck.id));
    return nextDeck;
  };

  const saveDeckChanges = async () => {
    if (dirtyDeckIds.size === 0) return;

    const updates = decks.filter((deck) => dirtyDeckIds.has(deck.id));
    await db.decks.bulkPut(updates);
    setDirtyDeckIds(new Set());
    const message = `${updates.length === 1 ? 'Pakka' : 'Pakat'} tallennettu.`;
    setStatus(message);
    setToast(message);
  };

  const handleSaveDeckChanges = async () => {
    try {
      await saveDeckChanges();
    } catch (error) {
      console.error('Pakkojen tallennus epäonnistui:', error);
      setStatus('Pakkojen tallennus epäonnistui. Muutokset ovat yhä tallentamatta.');
    }
  };

  const cancelDeckChanges = async () => {
    try {
      const storedDecks = await db.decks.orderBy('updatedAt').reverse().toArray();
      setDecks(storedDecks);
      setDirtyDeckIds(new Set());
      if (selectedDeckId && !storedDecks.some((deck) => deck.id === selectedDeckId)) {
        setSelectedDeckId(storedDecks[0]?.id ?? null);
      }
      setStatus('Pakan muutokset peruutettu.');
    } catch (error) {
      console.error('Pakkamuutosten peruminen epäonnistui:', error);
      setStatus('Pakkamuutoksia ei voitu perua.');
    }
  };

  const saveCollectionChanges = async () => {
    if (dirtyCollectionIds.size === 0) return;

    const dirtyIds = [...dirtyCollectionIds];
    const collectionById = new Map(collection.map((item) => [item.id, item]));
    await db.transaction('rw', db.collection, async () => {
      for (const id of dirtyIds) {
        const item = collectionById.get(id);
        if (item) {
          await db.collection.put(item);
        } else {
          await db.collection.delete(id);
        }
      }
    });
    setDirtyCollectionIds(new Set());
    const message = 'Kokoelma tallennettu.';
    setStatus(message);
    setToast(message);
  };

  const handleSaveCollectionChanges = async () => {
    try {
      await saveCollectionChanges();
    } catch (error) {
      console.error('Kokoelman tallennus epäonnistui:', error);
      setStatus('Kokoelman tallennus epäonnistui. Muutokset ovat yhä tallentamatta.');
    }
  };

  const cancelCollectionChanges = async () => {
    try {
      const storedCollection = await db.collection.orderBy('addedAt').reverse().toArray();
      setCollection(storedCollection);
      setDirtyCollectionIds(new Set());
      setStatus('Kokoelman muutokset peruutettu.');
    } catch (error) {
      console.error('Kokoelman muutosten peruminen epäonnistui:', error);
      setStatus('Kokoelman muutoksia ei voitu perua.');
    }
  };

  const navigateToTab = (nextTab: (typeof tabs)[number]['id']) => {
    setTab(nextTab);
  };

  const addCardToDeck = async (
    card: MtgCard,
    count = 1,
    targetDeckId = selectedDeckId,
  ) => {
    if (!targetDeckId) {
      setStatus('Luo ensin pakka');
      setToast('Luo ensin pakka, jotta voit lisätä kortin.');
      return;
    }

    const deck = decks.find((item) => item.id === targetDeckId);
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
    setStatus(`${card.name}: tallentamattomia muutoksia pakassa ${deck.name}.`);
  };

  const chooseDeckForCard = (card: MtgCard) => {
    if (decks.length === 0) {
      setStatus('Luo ensin pakka');
      setToast('Luo ensin pakka, jotta voit lisätä kortin.');
      return;
    }

    if (decks.length === 1) {
      void addCardToDeck(card, 1, decks[0].id).then(() => setTab('decks'));
      return;
    }

    setPendingDeckCard(card);
  };

  const updateCollectionCard = async (card: MtgCard, change: number) => {
    const existing = dirtyCollectionIds.has(card.id)
      ? collection.find((item) => item.id === card.id)
      : await db.collection.get(card.id);
    const count = (existing?.count ?? 0) + change;

    if (count <= 0) {
      setCollection((current) => current.filter((item) => item.id !== card.id));
    } else {
      const updatedItem: CollectionCard = {
        id: card.id,
        card,
        count,
        addedAt: existing?.addedAt ?? Date.now(),
      };
      setCollection((current) => [
        updatedItem,
        ...current.filter((item) => item.id !== card.id),
      ]);
    }

    setDirtyCollectionIds((current) => new Set(current).add(card.id));
    setStatus(`${card.name}: tallentamattomia muutoksia kokoelmassa.`);
  };

  const openPrintings = (card: MtgCard) => {
    setPreviewCard(null);
    setPrintings([]);
    setSelectedPrinting(card);
    setPrintingsPage(1);
    setPrintingsHasMore(false);
    setPrintingsError(null);
    setPrintingCard(card);
  };

  const chooseDeckForPrinting = (card: MtgCard) => {
    setPrintingCard(null);
    chooseDeckForCard(card);
  };

  const removeDeck = async (deckId: string) => {
    const deck = decks.find((item) => item.id === deckId);
    if (!deck || !window.confirm(`Poistetaanko pakka "${deck.name}" ja kaikki sen kortit? Tätä ei voi perua.`)) {
      setOpenDeckMenuId(null);
      return;
    }

    await db.decks.delete(deckId);
    const remainingDecks = decks.filter((item) => item.id !== deckId);
    setDecks(remainingDecks);
    if (selectedDeckId === deckId) {
      setSelectedDeckId(remainingDecks[0]?.id ?? null);
    }
    setDirtyDeckIds((current) => {
      const next = new Set(current);
      next.delete(deckId);
      return next;
    });
    setOpenDeckMenuId(null);
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
    setStatus(`Tuotiin ${entries.length} korttiriviä pakkaan ${deck.name}; tallenna muutokset Pakat-näkymässä.`);
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
        setToast('Tuonti onnistui.');
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
            <h1 className="text-xl font-semibold text-white">MTG - apulainen</h1>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 py-6 sm:px-6">
        <div className="mb-6 flex flex-wrap gap-2 rounded-xl border border-slate-800 bg-[#121722] p-2">
          {tabs.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => void navigateToTab(item.id)}
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
              <div className="mb-3 flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <h2 className="text-sm font-semibold uppercase tracking-[0.2em] text-slate-400">Pakat</h2>
                  <span className="rounded-full bg-slate-800 px-2 py-1 text-xs text-slate-300">{decks.length}</span>
                </div>
                <button
                  type="button"
                  onClick={() => void handleSaveDeckChanges()}
                  disabled={dirtyDeckIds.size === 0}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-violet-500/40 bg-violet-500/10 px-3 py-1.5 text-xs font-medium text-violet-200 hover:bg-violet-500/20 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <Save size={14} />
                  Tallenna{dirtyDeckIds.size > 0 ? ` (${dirtyDeckIds.size})` : ''}
                </button>
                {dirtyDeckIds.size > 0 && (
                  <button
                    type="button"
                    onClick={() => void cancelDeckChanges()}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-900 px-3 py-1.5 text-xs font-medium text-slate-300 hover:bg-slate-800"
                  >
                    <X size={14} />
                    Peruuta
                  </button>
                )}
              </div>

              <button
                type="button"
                onClick={openCreateDeckDialog}
                className="mb-3 inline-flex w-full items-center justify-center gap-2 rounded-lg bg-violet-500 px-3 py-2 text-sm font-medium text-white shadow-lg shadow-violet-500/20 transition hover:bg-violet-400"
              >
                <FolderPlus size={16} />
                Uusi pakka
              </button>

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
                      className="flex min-w-0 flex-1 items-center justify-between gap-2 text-left"
                    >
                      <div>
                        <div className="font-medium text-white">{deck.name}</div>
                      </div>
                    </button>
                    <div className="relative ml-2 flex shrink-0 items-center gap-1">
                      <span className="text-xs text-slate-400">
                        {deck.cards.reduce((sum, item) => sum + item.count, 0)} korttia
                      </span>
                      <button
                        type="button"
                        onClick={() => setOpenDeckMenuId((current) => current === deck.id ? null : deck.id)}
                        className="rounded-md p-1 text-slate-400 hover:bg-slate-800 hover:text-white"
                        aria-label={`Lisävalinnat: ${deck.name}`}
                        aria-expanded={openDeckMenuId === deck.id}
                      >
                        <MoreHorizontal size={18} />
                      </button>
                      {openDeckMenuId === deck.id && (
                        <div className="absolute right-0 top-full z-30 mt-1 min-w-36 rounded-lg border border-slate-700 bg-slate-900 p-1 shadow-xl">
                          <button
                            type="button"
                            onClick={() => openRenameDeckDialog(deck)}
                            className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm text-slate-200 hover:bg-slate-800"
                          >
                            <Pencil size={14} />
                            Nimeä uudelleen
                          </button>
                          <button
                            type="button"
                            onClick={() => void removeDeck(deck.id)}
                            className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm text-red-300 hover:bg-red-950/60"
                          >
                            <Trash2 size={14} />
                            Poista pakka
                          </button>
                        </div>
                      )}
                    </div>
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
                          <button
                            type="button"
                            onClick={() => setPreviewCard(entry.card)}
                            aria-label={`Näytä ${entry.card.name} isompana`}
                            className="shrink-0 rounded-md focus:outline-none focus:ring-2 focus:ring-violet-400"
                          >
                            <img
                              src={imageUrl ?? 'https://placehold.co/80x112/111827/9ca3af?text=MTG'}
                              alt={entry.card.name}
                              loading="lazy"
                              className="h-16 w-12 rounded-md object-cover"
                            />
                          </button>

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
                      <button
                        type="button"
                        onClick={() => setPreviewCard(card)}
                        aria-label={`Näytä ${card.name} isompana`}
                        className="shrink-0 rounded-md focus:outline-none focus:ring-2 focus:ring-violet-400"
                      >
                        <img
                          src={imageUrl ?? 'https://placehold.co/80x112/111827/9ca3af?text=MTG'}
                          alt={card.name}
                          loading="lazy"
                          className="h-16 w-12 rounded-md object-cover"
                        />
                      </button>
                      <div className="min-w-0 flex-1">
                        <div className="truncate font-medium text-white">{card.name}</div>
                        <div className="text-xs text-slate-400">{card.set.toUpperCase()} · #{card.collector_number} · {card.rarity}</div>
                      </div>
                    </div>
                    <div className="mb-3 rounded-lg border border-slate-800 bg-[#111722] p-3">
                      {card.card_faces?.length ? (
                        <div className="space-y-3">
                          {card.card_faces.map((face, index) => {
                            const stats = face.power !== undefined && face.toughness !== undefined
                              ? `${face.power}/${face.toughness}`
                              : face.loyalty !== undefined
                                ? `Uskollisuus ${face.loyalty}`
                                : face.defense !== undefined
                                  ? `Puolustus ${face.defense}`
                                  : undefined;
                            return (
                              <div key={`${face.name}-${index}`} className={index > 0 ? 'border-t border-slate-800 pt-3' : ''}>
                                <div className="flex items-start justify-between gap-2">
                                  <div className="min-w-0">
                                    <div className="text-xs font-medium text-slate-300">{face.name}</div>
                                    {face.type_line && <div className="mt-0.5 text-xs text-slate-500">{face.type_line}</div>}
                                  </div>
                                  {face.mana_cost && (
                                    <span className="shrink-0 rounded bg-slate-800 px-1.5 py-0.5 text-xs text-violet-200">
                                      <ManaText text={face.mana_cost} symbols={symbolUris} />
                                    </span>
                                  )}
                                </div>
                                {face.oracle_text && (
                                  <p className="mt-2 whitespace-pre-line text-xs leading-relaxed text-slate-300">
                                    <ManaText text={face.oracle_text} symbols={symbolUris} />
                                  </p>
                                )}
                                {stats && (
                                  <div className="mt-2 text-right text-xs font-semibold text-white">{stats}</div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      ) : (
                        <>
                          <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0 text-xs font-medium text-slate-300">{card.type_line}</div>
                            {card.mana_cost && (
                              <span className="shrink-0 rounded bg-slate-800 px-1.5 py-0.5 text-xs text-violet-200">
                                <ManaText text={card.mana_cost} symbols={symbolUris} />
                              </span>
                            )}
                          </div>
                          {card.oracle_text && (
                            <p className="mt-2 whitespace-pre-line text-xs leading-relaxed text-slate-300">
                              <ManaText text={card.oracle_text} symbols={symbolUris} />
                            </p>
                          )}
                          <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                            {card.keywords && card.keywords.length > 0 && (
                              <div className="flex flex-wrap gap-1">
                                {card.keywords.map((keyword) => (
                                  <span key={keyword} className="rounded bg-violet-500/10 px-1.5 py-0.5 text-[10px] text-violet-200">
                                    {keyword}
                                  </span>
                                ))}
                              </div>
                            )}
                            {card.power !== undefined && card.toughness !== undefined && (
                              <span className="ml-auto rounded bg-slate-800 px-2 py-0.5 text-xs font-semibold text-white">
                                {card.power}/{card.toughness}
                              </span>
                            )}
                            {card.loyalty !== undefined && (
                              <span className="ml-auto rounded bg-slate-800 px-2 py-0.5 text-xs font-semibold text-white">
                                Uskollisuus {card.loyalty}
                              </span>
                            )}
                            {card.defense !== undefined && (
                              <span className="ml-auto rounded bg-slate-800 px-2 py-0.5 text-xs font-semibold text-white">
                                Puolustus {card.defense}
                              </span>
                            )}
                          </div>
                        </>
                      )}
                      <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 border-t border-slate-800 pt-2 text-[10px] text-slate-500">
                        {card.cmc !== undefined && <span>Manan arvo {card.cmc}</span>}
                        {card.color_identity && card.color_identity.length > 0 && (
                          <span>Väri-identiteetti {card.color_identity.join('')}</span>
                        )}
                        {card.color_identity?.length === 0 && <span>Väritön</span>}
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                      <button
                        type="button"
                        onClick={() => chooseDeckForCard(card)}
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
                      <button
                        type="button"
                        onClick={() => openPrintings(card)}
                        className="col-span-2 inline-flex items-center justify-center gap-2 rounded-lg border border-violet-500/40 bg-violet-500/10 px-3 py-2 text-sm font-medium text-violet-200 hover:bg-violet-500/20 sm:col-span-1"
                      >
                        <Layers size={14} />
                        Versiot
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
              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded-full border border-violet-500/50 bg-violet-500/10 px-3 py-1 text-sm text-violet-200">
                  {collectionTotal} korttia · {collection.length} eri korttia
                </span>
                <button
                  type="button"
                  onClick={() => void handleSaveCollectionChanges()}
                  disabled={dirtyCollectionIds.size === 0}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-violet-500/40 bg-violet-500/10 px-3 py-1.5 text-xs font-medium text-violet-200 hover:bg-violet-500/20 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <Save size={14} />
                  Tallenna{dirtyCollectionIds.size > 0 ? ` (${dirtyCollectionIds.size})` : ''}
                </button>
                {dirtyCollectionIds.size > 0 && (
                  <button
                    type="button"
                    onClick={() => void cancelCollectionChanges()}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-900 px-3 py-1.5 text-xs font-medium text-slate-300 hover:bg-slate-800"
                  >
                    <X size={14} />
                    Peruuta
                  </button>
                )}
              </div>
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
                    <button
                      type="button"
                      onClick={() => setPreviewCard(entry.card)}
                      aria-label={`Näytä ${entry.card.name} isompana`}
                      className="shrink-0 rounded-md focus:outline-none focus:ring-2 focus:ring-violet-400"
                    >
                      <img
                        src={imageUrl ?? 'https://placehold.co/80x112/111827/9ca3af?text=MTG'}
                        alt={entry.card.name}
                        loading="lazy"
                        className="h-16 w-12 rounded-md object-cover"
                      />
                    </button>
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-medium text-white">{entry.card.name}</div>
                      <div className="text-xs text-slate-400">{entry.card.set.toUpperCase()} · {entry.card.type_line}</div>
                    </div>
                    <div className="flex flex-wrap items-center justify-end gap-2">
                      <button
                        type="button"
                        onClick={() => chooseDeckForCard(entry.card)}
                        className="rounded-md border border-slate-700 bg-slate-900 p-2 text-slate-200 hover:border-violet-500 hover:text-violet-200"
                        aria-label={`Lisää ${entry.card.name} pakkaan`}
                      >
                        <FolderPlus size={14} />
                      </button>
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

      {toast && (
        <div
          role="status"
          aria-live="polite"
          className="fixed left-1/2 top-4 z-[70] flex max-w-[calc(100vw-2rem)] -translate-x-1/2 items-center gap-2 rounded-xl border border-emerald-500/40 bg-emerald-950/95 px-4 py-3 text-sm font-medium text-emerald-100 shadow-xl shadow-black/30"
        >
          <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-emerald-500/20 text-emerald-300">✓</span>
          <span>{toast}</span>
        </div>
      )}

      {deckNameDialog && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm"
          role="presentation"
          onClick={() => setDeckNameDialog(null)}
        >
          <form
            role="dialog"
            aria-modal="true"
            aria-labelledby="deck-name-title"
            className="w-full max-w-md rounded-2xl border border-slate-700 bg-[#10141d] p-5 shadow-2xl"
            onClick={(event) => event.stopPropagation()}
            onSubmit={(event) => {
              event.preventDefault();
              void saveDeckName();
            }}
          >
            <h2 id="deck-name-title" className="text-lg font-semibold text-white">
              {deckNameDialog.mode === 'create' ? 'Luo uusi pakka' : 'Nimeä pakka uudelleen'}
            </h2>
            <label htmlFor="deck-name-input" className="mt-4 block text-sm text-slate-300">
              Pakan nimi
            </label>
            <input
              id="deck-name-input"
              autoFocus
              required
              maxLength={80}
              value={deckNameInput}
              onChange={(event) => setDeckNameInput(event.target.value)}
              placeholder="Esim. Mono Red"
              className="mt-2 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2.5 text-white placeholder:text-slate-500 focus:border-violet-500 focus:outline-none"
            />
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setDeckNameDialog(null)}
                className="rounded-lg border border-slate-700 bg-slate-900 px-4 py-2 text-sm text-slate-200 hover:bg-slate-800"
              >
                Peruuta
              </button>
              <button
                type="submit"
                disabled={!deckNameInput.trim()}
                className="inline-flex items-center gap-2 rounded-lg bg-violet-500 px-4 py-2 text-sm font-medium text-white hover:bg-violet-400 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {deckNameDialog.mode === 'create' ? <FolderPlus size={16} /> : <Save size={16} />}
                {deckNameDialog.mode === 'create' ? 'Luo pakka' : 'Tallenna nimi'}
              </button>
            </div>
          </form>
        </div>
      )}

      {pendingDeckCard && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm"
          role="presentation"
          onClick={() => setPendingDeckCard(null)}
        >
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="choose-deck-title"
            className="w-full max-w-md rounded-2xl border border-slate-700 bg-[#10141d] p-5 shadow-2xl"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="mb-4 flex items-start justify-between gap-4">
              <div>
                <h2 id="choose-deck-title" className="text-lg font-semibold text-white">Valitse pakka</h2>
                <p className="mt-1 text-sm text-slate-400">Mihin pakkaan lisätään {pendingDeckCard.name}?</p>
              </div>
              <button
                type="button"
                onClick={() => setPendingDeckCard(null)}
                aria-label="Sulje pakan valinta"
                className="rounded-lg bg-slate-800 p-2 text-slate-200 hover:bg-slate-700"
              >
                <X size={18} />
              </button>
            </div>
            <div className="max-h-[55dvh] space-y-2 overflow-y-auto">
              {decks.map((deck) => (
                <button
                  key={deck.id}
                  type="button"
                  onClick={() => {
                    const card = pendingDeckCard;
                    setPendingDeckCard(null);
                    setSelectedDeckId(deck.id);
                    void addCardToDeck(card, 1, deck.id).then(() => setTab('decks'));
                  }}
                  className="flex w-full items-center justify-between rounded-xl border border-slate-700 bg-slate-900 px-4 py-3 text-left hover:border-violet-500 hover:bg-violet-500/10"
                >
                  <span className="font-medium text-white">{deck.name}</span>
                  <span className="text-xs text-slate-400">
                    {deck.cards.reduce((total, item) => total + item.count, 0)} korttia
                  </span>
                </button>
              ))}
            </div>
          </section>
        </div>
      )}

      {previewCard && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 p-4 backdrop-blur-sm"
          role="presentation"
          onClick={() => setPreviewCard(null)}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label={`${previewCard.name} korttikuva`}
            className="relative flex max-h-[90dvh] max-w-full items-center justify-center"
            onClick={(event) => event.stopPropagation()}
          >
            <button
              type="button"
              onClick={() => setPreviewCard(null)}
              aria-label="Sulje kortin esikatselu"
              className="absolute -right-2 -top-2 z-10 rounded-full border border-slate-600 bg-slate-900 p-2 text-white shadow-lg hover:bg-slate-800"
            >
              <X size={20} />
            </button>
            <img
              src={getCardImageUrl(previewCard, 'large') ?? getCardImageUrl(previewCard, 'normal') ?? 'https://placehold.co/672x936/111827/9ca3af?text=MTG'}
              alt={previewCard.name}
              className="max-h-[88dvh] w-auto max-w-[min(90vw,32rem)] rounded-2xl object-contain shadow-2xl"
            />
          </div>
        </div>
      )}

      {printingCard && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 p-3 backdrop-blur-sm sm:p-6"
          role="presentation"
          onClick={() => setPrintingCard(null)}
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
                  {printingCard.name} – julkaisut
                </h2>
                <p className="mt-1 text-sm text-slate-400">Valitse haluamasi kuvitus ja painos.</p>
              </div>
              <button
                type="button"
                onClick={() => setPrintingCard(null)}
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
                  return (
                    <button
                      key={printing.id}
                      type="button"
                      onClick={() => setSelectedPrinting(printing)}
                      aria-pressed={isSelected}
                      className={`rounded-xl border p-2 text-left transition ${
                        isSelected
                          ? 'border-violet-400 bg-violet-500/15 ring-1 ring-violet-400'
                          : 'border-slate-800 bg-slate-950/70 hover:border-slate-600'
                      }`}
                    >
                      <img
                        src={imageUrl ?? 'https://placehold.co/488x680/111827/9ca3af?text=No+image'}
                        alt={`${printing.name}, ${printing.set_name ?? printing.set}`}
                        loading="lazy"
                        className="mx-auto aspect-[5/7] w-full rounded-lg object-cover"
                      />
                      <span className="mt-2 block truncate text-sm font-medium text-white">
                        {printing.set_name ?? printing.set.toUpperCase()}
                      </span>
                      <span className="block truncate text-xs text-slate-400">
                        {printing.set.toUpperCase()} · #{printing.collector_number}
                        {printing.lang ? ` · ${printing.lang.toUpperCase()}` : ''}
                      </span>
                    </button>
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
                  onClick={() => setPrintingsPage((page) => page + 1)}
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
                onClick={() => selectedPrinting && chooseDeckForPrinting(selectedPrinting)}
                className="inline-flex items-center justify-center gap-2 rounded-lg bg-violet-500 px-4 py-2.5 text-sm font-medium text-white hover:bg-violet-400 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Plus size={16} />
                Lisää valittu pakkaan
              </button>
              <button
                type="button"
                disabled={!selectedPrinting}
                onClick={() => selectedPrinting && void updateCollectionCard(selectedPrinting, 1)}
                className="inline-flex items-center justify-center gap-2 rounded-lg border border-slate-700 bg-slate-900 px-4 py-2.5 text-sm font-medium text-slate-200 hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Library size={16} />
                Lisää valittu kokoelmaan
              </button>
            </footer>
          </section>
        </div>
      )}
    </div>
  );
}

export default App;
