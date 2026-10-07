import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowUpDown,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Crown,
  Copy,
  Download,
  FolderPlus,
  LayoutGrid,
  Layers,
  Library,
  List,
  MoreHorizontal,
  Minus,
  Pencil,
  Plus,
  Save,
  Search,
  SlidersHorizontal,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import { db, exportAllData, importAllData } from './db';
import { fetchCardSymbolUris, fetchCardsBatch, getCardImageUrl, searchCardPrintings, searchCards } from './services/scryfall';
import type { CollectionCard, Deck, DeckCard, MtgCard } from './types';
import { parseCsvImport, parseDecklistText, type ParsedDeckEntry } from './utils/decklist';

const tabs = [
  { id: 'decks', label: 'Pakat', icon: Layers },
  { id: 'collection', label: 'Kokoelma', icon: Library },
  { id: 'search', label: 'Korttihaku', icon: Search },
  { id: 'import', label: 'Tuo / Vie', icon: ArrowUpDown },
] as const;

function readCardViewPreference(): 'list' | 'grid' {
  try {
    return window.localStorage.getItem('ez-mtg-card-view') === 'grid' ? 'grid' : 'list';
  } catch (error) {
    console.error('Korttinäkymän asetusta ei voitu lukea:', error);
    return 'list';
  }
}

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

function CardManaCost({ card, symbols }: { card: MtgCard; symbols: Map<string, string> }) {
  const manaCost = card.mana_cost ?? card.card_faces?.[0]?.mana_cost;
  return manaCost ? (
    <span className="inline-flex items-center rounded bg-slate-800 px-1.5 py-0.5 text-xs text-violet-200">
      <ManaText text={manaCost} symbols={symbols} />
    </span>
  ) : null;
}

function CardViewToggle({
  view,
  onChange,
}: {
  view: 'list' | 'grid';
  onChange: (view: 'list' | 'grid') => void;
}) {
  return (
    <div className="inline-flex rounded-lg border border-slate-700 bg-slate-950 p-1" aria-label="Korttinäkymä">
      <button
        type="button"
        onClick={() => onChange('list')}
        aria-label="Listanäkymä"
        aria-pressed={view === 'list'}
        className={`rounded-md p-1.5 ${view === 'list' ? 'bg-violet-500 text-white' : 'text-slate-400 hover:text-white'}`}
      >
        <List size={17} />
      </button>
      <button
        type="button"
        onClick={() => onChange('grid')}
        aria-label="Ruutunäkymä"
        aria-pressed={view === 'grid'}
        className={`rounded-md p-1.5 ${view === 'grid' ? 'bg-violet-500 text-white' : 'text-slate-400 hover:text-white'}`}
      >
        <LayoutGrid size={17} />
      </button>
    </div>
  );
}

type CardFilters = {
  color: string;
  type: string;
  manaValue: string;
  power: string;
  toughness: string;
};

type CardSortKey = 'name' | 'manaValue' | 'addedAt';
type SortDirection = 'asc' | 'desc';

function sortCardEntries<T extends { card: MtgCard; addedAt?: number }>(
  entries: T[],
  sortKey: CardSortKey,
  direction: SortDirection,
): T[] {
  const directionFactor = direction === 'asc' ? 1 : -1;
  return [...entries].sort((left, right) => {
    let comparison = 0;
    if (sortKey === 'name') {
      comparison = left.card.name.localeCompare(right.card.name, 'fi', { sensitivity: 'base' });
    } else if (sortKey === 'manaValue') {
      const leftManaValue = left.card.cmc;
      const rightManaValue = right.card.cmc;
      if (leftManaValue === undefined && rightManaValue !== undefined) return 1;
      if (leftManaValue !== undefined && rightManaValue === undefined) return -1;
      comparison = (leftManaValue ?? 0) - (rightManaValue ?? 0);
    } else {
      comparison = (left.addedAt ?? 0) - (right.addedAt ?? 0);
    }
    return comparison === 0
      ? left.card.name.localeCompare(right.card.name, 'fi', { sensitivity: 'base' })
      : comparison * directionFactor;
  });
}

const emptyCardFilters: CardFilters = {
  color: '',
  type: '',
  manaValue: '',
  power: '',
  toughness: '',
};

const cardTypeFilters = [
  ['creature', 'Olento'],
  ['instant', 'Instant'],
  ['sorcery', 'Sorcery'],
  ['artifact', 'Artifact'],
  ['enchantment', 'Enchantment'],
  ['planeswalker', 'Planeswalker'],
  ['land', 'Land'],
  ['battle', 'Battle'],
] as const;

function matchesCardFilters(card: MtgCard, filters: CardFilters) {
  const colors = card.colors ?? [];
  if (filters.color === 'colorless' && colors.length > 0) return false;
  if (filters.color === 'multicolor' && colors.length < 2) return false;
  if (filters.color && filters.color !== 'colorless' && filters.color !== 'multicolor' && !colors.includes(filters.color)) {
    return false;
  }

  const typeLines = [card.type_line, ...(card.card_faces?.map((face) => face.type_line).filter(Boolean) ?? [])]
    .join(' ')
    .toLowerCase();
  if (filters.type && !typeLines.includes(filters.type)) return false;

  if (filters.manaValue && card.cmc !== Number(filters.manaValue)) return false;

  const faces = card.card_faces ?? [];
  const stats = faces.length > 0
    ? faces.map((face) => ({ power: face.power, toughness: face.toughness }))
    : [{ power: card.power, toughness: card.toughness }];
  if (filters.power && !stats.some((stat) => stat.power?.toLowerCase() === filters.power.toLowerCase())) return false;
  if (filters.toughness && !stats.some((stat) => stat.toughness?.toLowerCase() === filters.toughness.toLowerCase())) return false;
  if (filters.power && filters.toughness && !stats.some((stat) =>
    stat.power?.toLowerCase() === filters.power.toLowerCase()
    && stat.toughness?.toLowerCase() === filters.toughness.toLowerCase())) return false;

  return true;
}

const deckCardCategories = [
  { id: 'creature', label: 'Creatures' },
  { id: 'planeswalker', label: 'Planeswalkers' },
  { id: 'artifact', label: 'Artifacts' },
  { id: 'enchantment', label: 'Enchantments' },
  { id: 'instant', label: 'Instants' },
  { id: 'sorcery', label: 'Sorceries' },
  { id: 'land', label: 'Lands' },
  { id: 'battle', label: 'Battles' },
  { id: 'other', label: 'Other' },
] as const;

type DeckDisplayItem =
  | { kind: 'section'; key: string; title: string }
  | { kind: 'card'; entry: DeckCard };

function getDeckCardCategory(card: MtgCard) {
  const typeLine = card.type_line.toLowerCase();
  return deckCardCategories.find((category) => category.id !== 'other' && typeLine.includes(category.id))?.id ?? 'other';
}

function CardFilterControls({
  filters,
  onChange,
  searchValue,
  onSearchChange,
  searchLabel,
  sortKey,
  onSortKeyChange,
  sortDirection,
  onSortDirectionChange,
}: {
  filters: CardFilters;
  onChange: (filters: CardFilters) => void;
  searchValue?: string;
  onSearchChange?: (value: string) => void;
  searchLabel?: string;
  sortKey?: CardSortKey;
  onSortKeyChange?: (value: CardSortKey) => void;
  sortDirection?: SortDirection;
  onSortDirectionChange?: (value: SortDirection) => void;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const hasFilters = Object.values(filters).some(Boolean);
  const activeFilterCount = Object.values(filters).filter(Boolean).length;
  const fieldClass = 'min-w-0 rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 focus:border-violet-500 focus:outline-none';

  return (
    <div className="mb-4">
      <div className="flex flex-wrap items-center gap-2">
        {onSearchChange && (
          <div className="flex min-w-0 flex-1 items-center gap-2 rounded-lg border border-slate-700 bg-slate-950/60 px-3 py-2 text-slate-400 focus-within:border-violet-500">
            <Search size={16} className="shrink-0" />
            <input
              type="search"
              value={searchValue ?? ''}
              onChange={(event) => onSearchChange(event.target.value)}
              aria-label={searchLabel}
              placeholder="Hae nimen tai tyypin mukaan..."
              className="min-w-0 flex-1 bg-transparent text-sm text-white placeholder:text-slate-500 focus:outline-none"
            />
            {searchValue && (
              <button
                type="button"
                onClick={() => onSearchChange('')}
                aria-label="Tyhjennä korttilistan haku"
                className="shrink-0 rounded-full p-0.5 text-slate-400 hover:bg-slate-800 hover:text-white"
              >
                <X size={16} />
              </button>
            )}
          </div>
        )}
        {sortKey && onSortKeyChange && sortDirection && onSortDirectionChange && (
          <div className="ml-auto flex shrink-0 items-center gap-1.5">
            <label htmlFor={`card-sort-${searchLabel ?? 'list'}`} className="sr-only">Järjestä kortit</label>
            <select
              id={`card-sort-${searchLabel ?? 'list'}`}
              value={sortKey}
              onChange={(event) => {
                const value = event.target.value;
                if (value === 'name' || value === 'manaValue' || value === 'addedAt') {
                  onSortKeyChange(value);
                }
              }}
              aria-label="Järjestä kortit"
              className="max-w-36 rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-2 text-sm text-slate-200 focus:border-violet-500 focus:outline-none"
            >
              <option value="name">Nimi</option>
              <option value="manaValue">Manan arvo</option>
              <option value="addedAt">Lisäyspäivä</option>
            </select>
            <button
              type="button"
              onClick={() => onSortDirectionChange(sortDirection === 'asc' ? 'desc' : 'asc')}
              aria-label={sortDirection === 'asc' ? 'Nouseva järjestys' : 'Laskeva järjestys'}
              title={sortDirection === 'asc' ? 'Nouseva järjestys' : 'Laskeva järjestys'}
              className="rounded-lg border border-slate-700 bg-slate-950/60 p-2 text-slate-300 hover:border-violet-500 hover:text-white"
            >
              <ArrowUpDown size={16} className={sortDirection === 'desc' ? 'rotate-180' : ''} />
            </button>
          </div>
        )}
        <button
          type="button"
          onClick={() => setIsOpen((open) => !open)}
          aria-expanded={isOpen}
          aria-controls="card-filters-panel"
          className={`inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-sm font-medium ${
            isOpen || hasFilters
              ? 'border-violet-500/50 bg-violet-500/10 text-violet-200'
              : 'border-slate-700 bg-slate-950/60 text-slate-300 hover:border-slate-600 hover:text-white'
          }`}
        >
          <SlidersHorizontal size={16} />
          Suodattimet
          {hasFilters && (
            <span className="rounded-full bg-violet-500 px-1.5 py-0.5 text-xs text-white">{activeFilterCount}</span>
          )}
        </button>
        {hasFilters && (
          <span className="text-xs text-slate-400">
            {activeFilterCount} aktiivista
          </span>
        )}
      </div>
      {isOpen && (
        <div id="card-filters-panel" className="mt-2 rounded-xl border border-slate-800 bg-slate-950/60 p-3">
          <div className="mb-2 flex justify-end">
            {hasFilters && (
              <button
                type="button"
                onClick={() => onChange(emptyCardFilters)}
                className="text-xs text-violet-300 hover:text-white"
              >
                Tyhjennä suodattimet
              </button>
            )}
          </div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
        <label className="grid gap-1 text-xs text-slate-400">
          Väri
          <select
            value={filters.color}
            onChange={(event) => onChange({ ...filters, color: event.target.value })}
            className={fieldClass}
          >
            <option value="">Kaikki värit</option>
            <option value="W">Valkoinen</option>
            <option value="U">Sininen</option>
            <option value="B">Musta</option>
            <option value="R">Punainen</option>
            <option value="G">Vihreä</option>
            <option value="colorless">Väritön</option>
            <option value="multicolor">Monivärinen</option>
          </select>
        </label>
        <label className="grid gap-1 text-xs text-slate-400">
          Korttityyppi
          <select
            value={filters.type}
            onChange={(event) => onChange({ ...filters, type: event.target.value })}
            className={fieldClass}
          >
            <option value="">Kaikki tyypit</option>
            {cardTypeFilters.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </label>
        <label className="grid gap-1 text-xs text-slate-400">
          Manan arvo
          <input
            type="number"
            min="0"
            step="any"
            inputMode="numeric"
            placeholder="Kaikki"
            value={filters.manaValue}
            onChange={(event) => onChange({ ...filters, manaValue: event.target.value })}
            className={fieldClass}
          />
        </label>
        <label className="grid gap-1 text-xs text-slate-400">
          Voima
          <input
            type="text"
            placeholder="Kaikki"
            value={filters.power}
            onChange={(event) => onChange({ ...filters, power: event.target.value })}
            className={fieldClass}
          />
        </label>
        <label className="grid gap-1 text-xs text-slate-400">
          Kestävyys
          <input
            type="text"
            placeholder="Kaikki"
            value={filters.toughness}
            onChange={(event) => onChange({ ...filters, toughness: event.target.value })}
            className={fieldClass}
          />
        </label>
          </div>
        </div>
      )}
    </div>
  );
}

function App() {
  const [tab, setTab] = useState<(typeof tabs)[number]['id']>('decks');
  const [decks, setDecks] = useState<Deck[]>([]);
  const [collection, setCollection] = useState<CollectionCard[]>([]);
  const [cardView, setCardView] = useState<'list' | 'grid'>(readCardViewPreference);
  const [deckFilters, setDeckFilters] = useState<CardFilters>(emptyCardFilters);
  const [collectionFilters, setCollectionFilters] = useState<CardFilters>(emptyCardFilters);
  const [searchFilters, setSearchFilters] = useState<CardFilters>(emptyCardFilters);
  const [deckSearch, setDeckSearch] = useState('');
  const [collectionSearch, setCollectionSearch] = useState('');
  const [dirtyDeckIds, setDirtyDeckIds] = useState<Set<string>>(() => new Set());
  const [dirtyCollectionIds, setDirtyCollectionIds] = useState<Set<string>>(() => new Set());
  const [deckPickerOpen, setDeckPickerOpen] = useState(false);
  const [openDeckMenuId, setOpenDeckMenuId] = useState<string | null>(null);
  const [commanderPickerDeckId, setCommanderPickerDeckId] = useState<string | null>(null);
  const [deckNameDialog, setDeckNameDialog] = useState<
    { mode: 'create' }
    | { mode: 'rename'; deckId: string }
    | { mode: 'duplicate'; deckId: string }
    | null
  >(null);
  const [deckSortKey, setDeckSortKey] = useState<CardSortKey>('name');
  const [deckSortDirection, setDeckSortDirection] = useState<SortDirection>('asc');
  const [collectionSortKey, setCollectionSortKey] = useState<CardSortKey>('name');
  const [collectionSortDirection, setCollectionSortDirection] = useState<SortDirection>('asc');
  const [deckNameInput, setDeckNameInput] = useState('');
  const [selectedDeckId, setSelectedDeckId] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [searchResults, setSearchResults] = useState<MtgCard[]>([]);
  const [selectedSearchFaces, setSelectedSearchFaces] = useState<Record<string, number>>({});
  const [searchTotal, setSearchTotal] = useState(0);
  const [searchPage, setSearchPage] = useState(1);
  const [searchHasMore, setSearchHasMore] = useState(false);
  const [visibleSearchCount, setVisibleSearchCount] = useState(12);
  const [loadingMoreSearchResults, setLoadingMoreSearchResults] = useState(false);
  const [symbolUris, setSymbolUris] = useState<Map<string, string>>(() => new Map());
  const [previewCard, setPreviewCard] = useState<MtgCard | null>(null);
  const [previewSource, setPreviewSource] = useState<'printings' | null>(null);
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
  const searchInputRef = useRef<HTMLInputElement>(null);

  const selectedDeck = decks.find((deck) => deck.id === selectedDeckId) ?? null;
  const commanderPickerDeck = decks.find((deck) => deck.id === commanderPickerDeckId) ?? null;
  const deckTotal = selectedDeck?.cards.reduce((sum, card) => sum + card.count, 0) ?? 0;
  const collectionTotal = collection.reduce((sum, item) => sum + item.count, 0);
  const filteredDeckCards = useMemo(
    () => {
      const query = deckSearch.trim().toLocaleLowerCase();
      return selectedDeck?.cards.filter(({ card }) => {
        const searchableText = [card.name, card.type_line, card.set_name, card.oracle_text, card.set]
          .filter(Boolean)
          .join(' ')
          .toLocaleLowerCase();
        return matchesCardFilters(card, deckFilters) && (!query || searchableText.includes(query));
      }) ?? [];
    },
    [selectedDeck, deckFilters, deckSearch],
  );
  const commanderEntry = selectedDeck?.cards.find((entry) => entry.cardId === selectedDeck.commanderCardId) ?? null;
  const sortedDeckCards = useMemo(
    () => sortCardEntries(filteredDeckCards, deckSortKey, deckSortDirection),
    [filteredDeckCards, deckSortKey, deckSortDirection],
  );
  const visibleDeckCards = useMemo(
    () => sortedDeckCards.filter((entry) => entry.cardId !== selectedDeck?.commanderCardId),
    [sortedDeckCards, selectedDeck?.commanderCardId],
  );
  const groupedDeckCards = useMemo(
    () => deckCardCategories
      .map((category) => ({
        ...category,
        cards: visibleDeckCards.filter((entry) => getDeckCardCategory(entry.card) === category.id),
      }))
      .filter((category) => category.cards.length > 0),
    [visibleDeckCards],
  );
  const deckDisplayItems = useMemo<DeckDisplayItem[]>(() => {
    const items: DeckDisplayItem[] = [];
    if (commanderEntry) {
      items.push({ kind: 'section', key: 'commander', title: 'Commander' });
      items.push({ kind: 'card', entry: commanderEntry });
    }
    for (const category of groupedDeckCards) {
      const count = category.cards.reduce((total, entry) => total + entry.count, 0);
      items.push({ kind: 'section', key: category.id, title: `${category.label} (${count})` });
      items.push(...category.cards.map((entry) => ({ kind: 'card' as const, entry })));
    }
    return items;
  }, [commanderEntry, groupedDeckCards]);
  const filteredCollection = useMemo(
    () => {
      const query = collectionSearch.trim().toLocaleLowerCase();
      const matches = collection.filter(({ card }) => {
        const searchableText = [card.name, card.type_line, card.set_name, card.oracle_text, card.set]
          .filter(Boolean)
          .join(' ')
          .toLocaleLowerCase();
        return matchesCardFilters(card, collectionFilters) && (!query || searchableText.includes(query));
      });
      return matches;
    },
    [collection, collectionFilters, collectionSearch],
  );
  const sortedCollection = useMemo(
    () => sortCardEntries(filteredCollection, collectionSortKey, collectionSortDirection),
    [filteredCollection, collectionSortKey, collectionSortDirection],
  );
  const importEntries = useMemo(() => parseDecklistText(importText), [importText]);
  const filteredSearchResults = useMemo(
    () => searchResults.filter((card) => matchesCardFilters(card, searchFilters)),
    [searchResults, searchFilters],
  );
  const visibleFilteredSearchResults = useMemo(
    () => filteredSearchResults.slice(0, visibleSearchCount),
    [filteredSearchResults, visibleSearchCount],
  );
  const previewCards = useMemo(() => {
    if (previewSource === 'printings') return printings;
    if (tab === 'search') {
      return visibleFilteredSearchResults.map((card) => ({
        ...card,
        selected_face_index: selectedSearchFaces[card.id] ?? 0,
      }));
    }
    if (tab === 'decks') return [...(commanderEntry ? [commanderEntry] : []), ...visibleDeckCards].map((entry) => entry.card);
    if (tab === 'collection') return sortedCollection.map((entry) => entry.card);
    return [];
  }, [previewSource, printings, tab, visibleFilteredSearchResults, selectedSearchFaces, commanderEntry, visibleDeckCards, sortedCollection]);
  const previewCardIndex = previewCards.findIndex((card) => card.id === previewCard?.id);
  const touchStartX = useRef<number | null>(null);

  useEffect(() => {
    if (!toast) return;
    const timeout = window.setTimeout(() => setToast(null), 3000);
    return () => window.clearTimeout(timeout);
  }, [toast]);

  useEffect(() => {
    try {
      window.localStorage.setItem('ez-mtg-card-view', cardView);
    } catch (error) {
      console.error('Korttinäkymän asetusta ei voitu tallentaa:', error);
    }
  }, [cardView]);

  useEffect(() => {
    if (tab === 'search') searchInputRef.current?.focus();
  }, [tab]);

  const refreshDecks = async () => {
    const items = await db.decks.orderBy('updatedAt').reverse().toArray();
    setDecks(items);
    if (items.length === 0) setDeckPickerOpen(true);
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
    if (!previewCard && !printingCard && !pendingDeckCard && !deckNameDialog && !commanderPickerDeckId) return;

    const closeOnEscape = (event: KeyboardEvent) => {
      if (previewCard && event.key === 'Escape') {
        setPreviewCard(null);
        setPreviewSource(null);
        return;
      }
      if (previewCard && event.key === 'ArrowLeft' && previewCardIndex > 0) {
        setPreviewCard(previewCards[previewCardIndex - 1]);
        return;
      }
      if (previewCard && event.key === 'ArrowRight' && previewCardIndex >= 0 && previewCardIndex < previewCards.length - 1) {
        setPreviewCard(previewCards[previewCardIndex + 1]);
        return;
      }
      if (event.key === 'Escape') {
        setPrintingCard(null);
        setPendingDeckCard(null);
        setDeckNameDialog(null);
        setCommanderPickerDeckId(null);
      }
    };
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', closeOnEscape);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', closeOnEscape);
    };
  }, [previewCard, previewCardIndex, previewCards, printingCard, pendingDeckCard, deckNameDialog, commanderPickerDeckId]);

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
    let cancelled = false;
    const trimmed = searchTerm.trim();
    setSearchResults([]);
    setSelectedSearchFaces({});
    setSearchTotal(0);
    setSearchPage(1);
    setSearchHasMore(false);
    setVisibleSearchCount(12);

    if (trimmed.length < 2) {
      setLoading(false);
      return;
    }

    const timer = window.setTimeout(async () => {
      try {
        setLoading(true);
        const results = await searchCards(trimmed, 1);
        if (cancelled) return;
        setSearchResults(results.cards);
        setSearchTotal(results.totalCards);
        setSearchHasMore(results.hasMore);
        setStatus(`Löytyi ${results.totalCards} korttia`);
      } catch (error) {
        if (cancelled) return;
        setStatus('Korttien haku epäonnistui');
        console.error(error);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, 250);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [searchTerm]);

  const loadMoreSearchResults = async () => {
    if (loading || loadingMoreSearchResults) return;

    if (visibleSearchCount < filteredSearchResults.length) {
      setVisibleSearchCount((count) => Math.min(count + 12, filteredSearchResults.length));
      return;
    }

    if (!searchHasMore) return;

    const query = searchTerm.trim();
    const nextPage = searchPage + 1;
    setLoadingMoreSearchResults(true);
    try {
      const result = await searchCards(query, nextPage);
      if (searchTerm.trim() !== query) return;
      setSearchResults((current) => [...current, ...result.cards]);
      setSearchPage(nextPage);
      setSearchHasMore(result.hasMore);
      setSearchTotal(result.totalCards);
      setVisibleSearchCount((count) => count + 12);
    } catch (error) {
      console.error('Lisää hakutuloksia ei voitu ladata:', error);
      setStatus('Lisää hakutuloksia ei voitu ladata. Yritä uudelleen.');
    } finally {
      setLoadingMoreSearchResults(false);
    }
  };

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
    setDeckPickerOpen(false);
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

  const openDuplicateDeckDialog = (deck: Deck) => {
    setDeckNameInput(`${deck.name} (kopio)`);
    setDeckNameDialog({ mode: 'duplicate', deckId: deck.id });
    setOpenDeckMenuId(null);
  };

  const duplicateDeck = async (sourceDeck: Deck, name: string) => {
    const now = Date.now();
    const copiedDeck: Deck = {
      ...sourceDeck,
      id: crypto.randomUUID(),
      name,
      cards: sourceDeck.cards.map((entry) => ({ ...entry })),
      createdAt: now,
      updatedAt: now,
    };
    await db.decks.put(copiedDeck);
    setDecks((current) => [copiedDeck, ...current]);
    setSelectedDeckId(copiedDeck.id);
    setDeckPickerOpen(false);
    setDeckNameDialog(null);
    setDeckNameInput('');
    setStatus(`Pakka "${name}" kopioitu.`);
    setToast(`Pakka "${name}" kopioitu.`);
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

    if (deckNameDialog?.mode === 'duplicate') {
      const deck = decks.find((item) => item.id === deckNameDialog.deckId);
      if (!deck) {
        setStatus('Kopioitavaa pakkaa ei löytynyt.');
        setDeckNameDialog(null);
        return;
      }
      await duplicateDeck(deck, name);
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

  const setDeckCommander = async (deckId: string, cardId: string | null) => {
    const deck = decks.find((item) => item.id === deckId);
    if (!deck) return;
    if (cardId && !deck.cards.some((entry) => entry.cardId === cardId)) {
      setStatus('Commander-korttia ei löytynyt pakasta.');
      return;
    }
    await updateDeck({ ...deck, commanderCardId: cardId ?? undefined });
    setCommanderPickerDeckId(null);
    const commander = deck.cards.find((entry) => entry.cardId === cardId);
    const message = commander ? `${commander.card.name} asetettu commanderiksi.` : 'Commander poistettu pakasta.';
    setStatus(`${message} Tallenna muutokset.`);
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
        card,
        count: Math.max(0, nextCards[existingIndex].count + count),
      };
      if (nextCards[existingIndex].count === 0) {
        nextCards.splice(existingIndex, 1);
      }
    } else if (count > 0) {
      nextCards.push({ cardId: card.id, card, count, addedAt: Date.now(), isSideboard: false });
    }

    const updatedDeck = {
      ...deck,
      cards: nextCards,
      commanderCardId: nextCards.some((entry) => entry.cardId === deck.commanderCardId)
        ? deck.commanderCardId
        : undefined,
    };
    await updateDeck(updatedDeck);
    const message = count > 0
      ? `${card.name} lisätty pakkaan ${deck.name}. Muista tallentaa muutokset.`
      : `${card.name}: tallentamattomia muutoksia pakassa ${deck.name}.`;
    setStatus(message);
    if (count > 0) setToast(message);
  };

  const chooseDeckForCard = (card: MtgCard) => {
    if (decks.length === 0) {
      setStatus('Luo ensin pakka');
      setToast('Luo ensin pakka, jotta voit lisätä kortin.');
      return;
    }

    if (decks.length === 1) {
      void addCardToDeck(card, 1, decks[0].id);
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
    const message = change > 0
      ? `${card.name} lisätty kokoelmaan. Muista tallentaa muutokset.`
      : `${card.name}: tallentamattomia muutoksia kokoelmassa.`;
    setStatus(message);
    if (change > 0) setToast(message);
  };

  const openPrintings = (card: MtgCard) => {
    setPreviewCard(null);
    setPreviewSource(null);
    setPrintings([]);
    setSelectedPrinting(card);
    setPrintingsPage(1);
    setPrintingsHasMore(false);
    setPrintingsError(null);
    setPrintingCard(card);
  };

  const openCardPreview = (card: MtgCard, source: 'printings' | null = null) => {
    setPreviewSource(source);
    setPreviewCard(card);
  };

  const closeCardPreview = () => {
    setPreviewCard(null);
    setPreviewSource(null);
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
      if (remainingDecks.length === 0) setDeckPickerOpen(true);
    }
    setDirtyDeckIds((current) => {
      const next = new Set(current);
      next.delete(deckId);
      return next;
    });
    setOpenDeckMenuId(null);
    setStatus('Pakka poistettu');
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
        nextCards.push({ cardId: card.id, card, count: entry.count, addedAt: Date.now(), isSideboard: false });
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
    link.download = 'ez-mtg-export.json';
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
            <p className="text-[10px] uppercase tracking-[0.25em] text-violet-400">pakanrakentajan kaveri</p>
            <h1 className="text-xl font-semibold text-violet-400">EZ MTG</h1>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 py-6 pb-28 sm:px-6 lg:pb-6">
        <div className="mb-6 hidden flex-wrap gap-2 rounded-xl border border-slate-800 bg-[#121722] p-2 lg:flex">
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
              <span className="inline-flex items-center gap-2">
                {item.label}
                {((item.id === 'decks' && dirtyDeckIds.size > 0)
                  || (item.id === 'collection' && dirtyCollectionIds.size > 0)) && (
                  <span
                    aria-label="Tallentamattomia muutoksia"
                    title="Tallentamattomia muutoksia"
                    className="h-2 w-2 rounded-full bg-amber-400"
                  />
                )}
              </span>
            </button>
          ))}
        </div>

        {tab === 'decks' && (
          <div className="space-y-4">
            <aside className="rounded-2xl border border-slate-800 bg-[#10141d] p-3">
              <button
                type="button"
                onClick={() => setDeckPickerOpen((open) => !open)}
                aria-expanded={deckPickerOpen}
                aria-controls="deck-picker-panel"
                className="flex w-full items-center justify-between gap-3 rounded-xl px-2 py-2 text-left hover:bg-slate-900/70"
              >
                <span className="flex min-w-0 items-center gap-3">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-violet-500/10 text-violet-300">
                    <Layers size={18} />
                  </span>
                  <span className="min-w-0">
                    <span className="flex items-center gap-2">
                      <span className="truncate font-semibold text-white">{selectedDeck?.name ?? 'Valitse pakka'}</span>
                      {dirtyDeckIds.size > 0 && (
                        <span
                          aria-label="Tallentamattomia muutoksia"
                          title="Tallentamattomia muutoksia"
                          className="h-2 w-2 shrink-0 rounded-full bg-amber-400"
                        />
                      )}
                    </span>
                    <span className="block text-xs text-slate-400">
                      {decks.length} pakkaa{selectedDeck ? ` · ${deckTotal} korttia` : ''}
                    </span>
                  </span>
                </span>
                <ChevronDown
                  size={18}
                  className={`shrink-0 text-slate-400 transition-transform ${deckPickerOpen ? 'rotate-180' : ''}`}
                />
              </button>

              {deckPickerOpen && (
                <div id="deck-picker-panel" className="mt-3 border-t border-slate-800 pt-3">
                  <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                    <h2 className="text-sm font-semibold uppercase tracking-[0.2em] text-slate-400">Pakat</h2>
                    <div className="flex items-center gap-2">
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
                  </div>

                  <button
                    type="button"
                    onClick={openCreateDeckDialog}
                    className="mb-3 inline-flex w-full items-center justify-center gap-2 rounded-lg bg-violet-500 px-3 py-2 text-sm font-medium text-white shadow-lg shadow-violet-500/20 transition hover:bg-violet-400"
                  >
                    <FolderPlus size={16} />
                    Uusi pakka
                  </button>

                  <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
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
                      onClick={() => {
                        setSelectedDeckId(deck.id);
                        setDeckPickerOpen(false);
                        setOpenDeckMenuId(null);
                      }}
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
                            onClick={() => {
                              setOpenDeckMenuId(null);
                              setCommanderPickerDeckId(deck.id);
                            }}
                            disabled={deck.cards.length === 0}
                            className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm text-slate-200 hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-40"
                          >
                            <Crown size={14} />
                            {deck.commanderCardId ? 'Vaihda commander' : 'Aseta commander'}
                          </button>
                          <button
                            type="button"
                            onClick={() => openDuplicateDeckDialog(deck)}
                            className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm text-slate-200 hover:bg-slate-800"
                          >
                            <Copy size={14} />
                            Kopioi pakka
                          </button>
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
                </div>
              )}
            </aside>

            <section className="rounded-2xl border border-slate-800 bg-[#111827] p-4">
              {selectedDeck ? (
                <>
                  <div className="mb-4 flex flex-col gap-3 border-b border-slate-800 pb-4 md:flex-row md:items-center md:justify-between">
                    <div>
                      <div className="text-xs uppercase tracking-[0.25em] text-slate-400">Valittu pakka</div>
                      <h2 className="mt-1 text-2xl font-semibold text-white">{selectedDeck.name}</h2>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="rounded-full border border-violet-500/50 bg-violet-500/10 px-3 py-1 text-sm text-violet-200">
                        {deckTotal} korttia
                      </div>
                      <CardViewToggle view={cardView} onChange={setCardView} />
                    </div>
                  </div>

                  <CardFilterControls
                    filters={deckFilters}
                    onChange={setDeckFilters}
                    searchValue={deckSearch}
                    onSearchChange={setDeckSearch}
                    searchLabel="Hae valitun pakan korteista"
                    sortKey={deckSortKey}
                    onSortKeyChange={setDeckSortKey}
                    sortDirection={deckSortDirection}
                    onSortDirectionChange={setDeckSortDirection}
                  />
                  <p className="mb-3 text-xs text-slate-400">
                    Näytetään {filteredDeckCards.length + (commanderEntry && !filteredDeckCards.some((entry) => entry.cardId === commanderEntry.cardId) ? 1 : 0)} / {selectedDeck.cards.length} eri korttia
                  </p>
                  <div className={cardView === 'grid' ? 'grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4' : 'space-y-2'}>
                    {selectedDeck.cards.length === 0 && <p className="text-slate-400">Pakka on tyhjä. Hae kortteja ja lisää ne pakkaan.</p>}
                    {selectedDeck.cards.length > 0 && filteredDeckCards.length === 0 && !commanderEntry && (
                      <p className={cardView === 'grid' ? 'col-span-full text-slate-400' : 'text-slate-400'}>
                        Haulla tai suodattimilla ei löytynyt kortteja.
                      </p>
                    )}
                    {deckDisplayItems.map((item) => {
                      if (item.kind === 'section') {
                        return (
                          <h3
                            key={item.key}
                            className={`border-b border-slate-700 pb-2 text-sm font-semibold uppercase tracking-wider text-violet-200 ${cardView === 'grid' ? 'col-span-full pt-2' : 'pt-4 first:pt-0'}`}
                          >
                            {item.title}
                          </h3>
                        );
                      }
                      const entry = item.entry;
                      const imageUrl = getCardImageUrl(entry.card, cardView === 'grid' ? 'normal' : 'small');
                      const stats = entry.card.power !== undefined && entry.card.toughness !== undefined
                        ? `${entry.card.power}/${entry.card.toughness}`
                        : entry.card.loyalty !== undefined
                          ? `Uskollisuus ${entry.card.loyalty}`
                          : entry.card.defense !== undefined
                            ? `Puolustus ${entry.card.defense}`
                            : null;
                      return (
                        <div
                          key={entry.cardId}
                          className={cardView === 'grid'
                            ? 'overflow-hidden rounded-xl border border-slate-800 bg-slate-950/80 p-2'
                            : 'flex items-center gap-3 rounded-xl border border-slate-800 bg-slate-950/80 p-3'}
                        >
                          {cardView === 'grid' ? (
                            <>
                              <button
                                type="button"
                                onClick={() => openCardPreview(entry.card)}
                                aria-label={`Näytä ${entry.card.name} isompana`}
                                className="block w-full overflow-hidden rounded-lg focus:outline-none focus:ring-2 focus:ring-violet-400"
                              >
                                <img
                                  src={imageUrl ?? 'https://placehold.co/488x680/111827/9ca3af?text=MTG'}
                                  alt={entry.card.name}
                                  loading="lazy"
                                  className="aspect-[5/7] w-full object-cover"
                                />
                              </button>
                              <div className="mt-2 min-h-12">
                                <div className="truncate text-sm font-medium text-white" title={entry.card.name}>{entry.card.name}</div>
                                <div className="mt-1"><CardManaCost card={entry.card} symbols={symbolUris} /></div>
                              </div>
                              <div className="mt-2 flex items-center justify-between gap-2">
                                <button
                                  type="button"
                                  onClick={() => void addCardToDeck(entry.card, -1)}
                                  className="rounded-md bg-slate-800 p-2 text-slate-200 hover:bg-slate-700"
                                  aria-label={`Vähennä ${entry.card.name}`}
                                >
                                  <Minus size={14} />
                                </button>
                                <span className="text-sm font-semibold text-white">{entry.count}</span>
                                <button
                                  type="button"
                                  onClick={() => void addCardToDeck(entry.card, 1)}
                                  className="rounded-md bg-violet-500 p-2 text-white hover:bg-violet-400"
                                  aria-label={`Lisää ${entry.card.name}`}
                                >
                                  <Plus size={14} />
                                </button>
                              </div>
                            </>
                          ) : (
                            <>
                              <button
                                type="button"
                                onClick={() => openCardPreview(entry.card)}
                                aria-label={`Näytä ${entry.card.name} isompana`}
                                className="min-w-0 flex-1 rounded text-left focus:outline-none focus:ring-2 focus:ring-violet-400"
                              >
                                <div className="flex flex-wrap items-center gap-2">
                                  <span className="font-medium text-white">{entry.card.name}</span>
                                  <CardManaCost card={entry.card} symbols={symbolUris} />
                                  {stats && <span className="rounded bg-slate-800 px-2 py-0.5 text-xs font-semibold text-white">{stats}</span>}
                                </div>
                                <div className="mt-1 text-xs text-slate-400">
                                  {entry.card.type_line} · {entry.card.set.toUpperCase()} #{entry.card.collector_number}
                                </div>
                              </button>
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
                            </>
                          )}
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
                ref={searchInputRef}
                value={searchTerm}
                onChange={(event) => setSearchTerm(event.target.value)}
                placeholder="Hae korttia, esim. Lightning Bolt..."
                className="w-full min-w-0 bg-transparent text-sm text-white placeholder:text-slate-500 focus:outline-none"
              />
              {searchTerm && (
                <button
                  type="button"
                  onClick={() => setSearchTerm('')}
                  aria-label="Tyhjennä korttihaku"
                  className="shrink-0 rounded-full p-1 text-slate-400 hover:bg-slate-800 hover:text-white"
                >
                  <X size={18} />
                </button>
              )}
            </div>

            <CardFilterControls filters={searchFilters} onChange={setSearchFilters} />
            {loading && <p className="mb-4 text-sm text-slate-400">Haetaan kortteja...</p>}
            {!loading && searchTerm.trim().length >= 2 && (
              <p className="mb-4 text-sm text-slate-400">
                Näytetään {visibleFilteredSearchResults.length} / {filteredSearchResults.length} suodatettua korttia ({searchResults.length} ladattua, {searchTotal} haussa)
              </p>
            )}

            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {!loading && searchResults.length > 0 && filteredSearchResults.length === 0 && (
                <p className="col-span-full text-slate-400">Suodattimilla ei löytynyt kortteja.</p>
              )}
              {visibleFilteredSearchResults.map((card) => {
                const selectedFaceIndex = selectedSearchFaces[card.id] ?? 0;
                const cardWithSelectedFace = { ...card, selected_face_index: selectedFaceIndex };
                const imageUrl = getCardImageUrl(cardWithSelectedFace, 'small');
                return (
                  <div key={card.id} className="rounded-xl border border-slate-800 bg-slate-950/80 p-3">
                    <div className="mb-3 flex items-center gap-3">
                      <button
                        type="button"
                        onClick={() => openCardPreview(cardWithSelectedFace)}
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
                    {card.card_faces && card.card_faces.length > 1 && (
                      <div className="mb-3 flex flex-wrap gap-2" aria-label={`${card.name} facen valinta`}>
                        {card.card_faces.map((face, index) => (
                          <button
                            key={`${face.name}-${index}`}
                            type="button"
                            onClick={() => setSelectedSearchFaces((current) => ({ ...current, [card.id]: index }))}
                            aria-pressed={selectedFaceIndex === index}
                            className={`rounded-lg border px-3 py-1.5 text-xs font-medium transition ${
                              selectedFaceIndex === index
                                ? 'border-violet-400 bg-violet-500/15 text-violet-100'
                                : 'border-slate-700 bg-slate-900 text-slate-300 hover:border-slate-500'
                            }`}
                          >
                            {face.name}
                          </button>
                        ))}
                      </div>
                    )}
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
                        onClick={() => chooseDeckForCard(cardWithSelectedFace)}
                        className="inline-flex items-center justify-center gap-2 rounded-lg bg-violet-500 px-3 py-2 text-sm font-medium text-white hover:bg-violet-400"
                      >
                        <Plus size={14} />
                        Lisää pakkaan
                      </button>
                      <button
                        type="button"
                        onClick={() => void updateCollectionCard(cardWithSelectedFace, 1)}
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
            {(visibleSearchCount < filteredSearchResults.length || searchHasMore) && (
              <button
                type="button"
                onClick={() => void loadMoreSearchResults()}
                disabled={loading || loadingMoreSearchResults}
                className="mx-auto mt-5 flex min-w-40 items-center justify-center rounded-lg border border-slate-700 bg-slate-900 px-4 py-2.5 text-sm font-medium text-slate-200 hover:border-violet-500 hover:bg-slate-800 disabled:cursor-wait disabled:opacity-60"
              >
                {loadingMoreSearchResults
                  ? 'Haetaan lisää...'
                  : visibleSearchCount < filteredSearchResults.length
                    ? 'Katso lisää'
                    : 'Hae lisää tuloksia'}
              </button>
            )}
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
                <CardViewToggle view={cardView} onChange={setCardView} />
              </div>
            </div>

            <CardFilterControls
              filters={collectionFilters}
              onChange={setCollectionFilters}
              searchValue={collectionSearch}
              onSearchChange={setCollectionSearch}
              searchLabel="Hae kokoelman korteista"
              sortKey={collectionSortKey}
              onSortKeyChange={setCollectionSortKey}
              sortDirection={collectionSortDirection}
              onSortDirectionChange={setCollectionSortDirection}
            />
            <p className="mb-3 text-xs text-slate-400">
              Näytetään {sortedCollection.length} / {collection.length} eri korttia
            </p>
            <div className={cardView === 'grid' ? 'grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-5' : 'space-y-2'}>
              {collection.length === 0 && (
                <p className={`rounded-xl border border-dashed border-slate-700 p-6 text-center text-slate-400 ${cardView === 'grid' ? 'col-span-full' : ''}`}>
                  Kokoelma on tyhjä. Hae kortteja ja lisää ne kokoelmaan Korttihaku-välilehdeltä.
                </p>
              )}
              {collection.length > 0 && sortedCollection.length === 0 && (
                <p className={cardView === 'grid' ? 'col-span-full text-slate-400' : 'text-slate-400'}>
                  Haulla tai suodattimilla ei löytynyt kortteja.
                </p>
              )}
              {sortedCollection.map((entry) => {
                const imageUrl = getCardImageUrl(entry.card, cardView === 'grid' ? 'normal' : 'small');
                const stats = entry.card.power !== undefined && entry.card.toughness !== undefined
                  ? `${entry.card.power}/${entry.card.toughness}`
                  : entry.card.loyalty !== undefined
                    ? `Uskollisuus ${entry.card.loyalty}`
                    : entry.card.defense !== undefined
                      ? `Puolustus ${entry.card.defense}`
                      : null;
                return (
                  <div
                    key={entry.id}
                    className={cardView === 'grid'
                      ? 'overflow-hidden rounded-xl border border-slate-800 bg-slate-950/80 p-2'
                      : 'flex items-center gap-3 rounded-xl border border-slate-800 bg-slate-950/80 p-3'}
                  >
                    {cardView === 'grid' ? (
                      <>
                        <button
                          type="button"
                          onClick={() => openCardPreview(entry.card)}
                          aria-label={`Näytä ${entry.card.name} isompana`}
                          className="block w-full overflow-hidden rounded-lg focus:outline-none focus:ring-2 focus:ring-violet-400"
                        >
                          <img
                            src={imageUrl ?? 'https://placehold.co/488x680/111827/9ca3af?text=MTG'}
                            alt={entry.card.name}
                            loading="lazy"
                            className="aspect-[5/7] w-full object-cover"
                          />
                        </button>
                        <div className="mt-2 min-h-12">
                          <div className="truncate text-sm font-medium text-white" title={entry.card.name}>{entry.card.name}</div>
                          <div className="mt-1"><CardManaCost card={entry.card} symbols={symbolUris} /></div>
                        </div>
                        <div className="mt-2 flex items-center justify-between gap-1">
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
                          <span className="min-w-5 text-center text-sm font-semibold text-white">{entry.count}</span>
                          <button
                            type="button"
                            onClick={() => void updateCollectionCard(entry.card, 1)}
                            className="rounded-md bg-violet-500 p-2 text-white hover:bg-violet-400"
                            aria-label={`Lisää ${entry.card.name} kokoelmaan`}
                          >
                            <Plus size={14} />
                          </button>
                        </div>
                      </>
                    ) : (
                      <>
                        <button
                          type="button"
                          onClick={() => openCardPreview(entry.card)}
                          aria-label={`Näytä ${entry.card.name} isompana`}
                          className="min-w-0 flex-1 rounded text-left focus:outline-none focus:ring-2 focus:ring-violet-400"
                        >
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="font-medium text-white">{entry.card.name}</span>
                            <CardManaCost card={entry.card} symbols={symbolUris} />
                            {stats && <span className="rounded bg-slate-800 px-2 py-0.5 text-xs font-semibold text-white">{stats}</span>}
                          </div>
                          <div className="mt-1 text-xs text-slate-400">
                            {entry.card.type_line} · {entry.card.set.toUpperCase()} #{entry.card.collector_number}
                          </div>
                        </button>
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
                      </>
                    )}
                  </div>
                );
              })}
            </div>
          </section>
        )}

        {tab === 'import' && (
          <section className="grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
            <div className="rounded-2xl border border-slate-800 bg-[#10141d] p-4">
              <h2 className="mb-3 text-lg font-semibold text-white">Korttien tuonti ja vienti</h2>
              <textarea
                value={importText}
                onChange={(event) => setImportText(event.target.value)}
                placeholder={'4 Lightning Bolt (M25) 141\n2 Counterspell\nSideboard\n2 Pyroblast'}
                className="min-h-[220px] w-full rounded-xl border border-slate-700 bg-slate-950/80 p-3 text-sm text-slate-100 placeholder:text-slate-500 focus:border-violet-500 focus:outline-none"
              />
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => void applyImportedEntries(importEntries)}
                  className="inline-flex items-center gap-2 rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm font-medium text-slate-200 hover:bg-slate-800"
                >
                  <Layers size={16} />
                  Lisää pakkaan
                </button>
                <button
                  type="button"
                  onClick={async () => {
                    const result = await fetchCardsBatch(importEntries.map((entry) => ({ name: entry.name })));
                    const cardsByName = new Map(result.found.map((card) => [card.name.toLowerCase(), card]));
                    for (const entry of importEntries) {
                      const card = cardsByName.get(entry.name.toLowerCase());
                      if (card) await updateCollectionCard(card, entry.count);
                    }
                  }}
                  className="inline-flex items-center gap-2 rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm font-medium text-slate-200 hover:bg-slate-800"
                >
                  <Library size={16} />
                  Lisää kokoelmaan
                </button>
                <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-200 hover:bg-slate-800">
                  <Upload size={16} />
                  Tuo CSV / JSON
                  <input type="file" accept=".csv,.json,.txt" className="hidden" onChange={handleFileImport} />
                </label>
                <button
                  type="button"
                  onClick={() => void handleExport()}
                  className="inline-flex items-center gap-2 rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-200 hover:bg-slate-800"
                >
                  <Download size={16} />
                  Vie JSON
                </button>
              </div>
            </div>
          </section>
        )}
      </main>

      <nav
        aria-label="Päänavigaatio"
        className="fixed inset-x-0 bottom-0 z-40 border-t border-slate-700 bg-[#10141d]/95 pb-[env(safe-area-inset-bottom)] shadow-[0_-8px_24px_rgba(0,0,0,0.3)] backdrop-blur-lg lg:hidden"
      >
        <div className="mx-auto grid max-w-xl grid-cols-4">
          {tabs.map((item) => {
            const Icon = item.icon;
            const hasUnsavedChanges = (item.id === 'decks' && dirtyDeckIds.size > 0)
              || (item.id === 'collection' && dirtyCollectionIds.size > 0);
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => void navigateToTab(item.id)}
                aria-current={tab === item.id ? 'page' : undefined}
                aria-label={item.label}
                className={`relative flex min-h-16 flex-col items-center justify-center gap-1 px-1 py-2 text-xs font-medium transition ${
                  tab === item.id ? 'text-violet-300' : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                <span className={`relative flex h-8 w-12 items-center justify-center rounded-full ${
                  tab === item.id ? 'bg-violet-500/15' : ''
                }`}>
                  <Icon size={21} strokeWidth={tab === item.id ? 2.4 : 1.8} />
                  {hasUnsavedChanges && (
                    <span
                      aria-label="Tallentamattomia muutoksia"
                      className="absolute right-2 top-0 h-2 w-2 rounded-full bg-amber-400 ring-2 ring-[#10141d]"
                    />
                  )}
                </span>
                <span>{item.label}</span>
              </button>
            );
          })}
        </div>
      </nav>

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
              {deckNameDialog.mode === 'create'
                ? 'Luo uusi pakka'
                : deckNameDialog.mode === 'duplicate'
                  ? 'Kopioi pakka'
                  : 'Nimeä pakka uudelleen'}
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
                {deckNameDialog.mode === 'create'
                  ? <FolderPlus size={16} />
                  : deckNameDialog.mode === 'duplicate'
                    ? <Copy size={16} />
                    : <Save size={16} />}
                {deckNameDialog.mode === 'create'
                  ? 'Luo pakka'
                  : deckNameDialog.mode === 'duplicate'
                    ? 'Kopioi pakka'
                    : 'Tallenna nimi'}
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
                    setDeckPickerOpen(false);
                    void addCardToDeck(card, 1, deck.id);
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

      {commanderPickerDeck && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm"
          role="presentation"
          onClick={() => setCommanderPickerDeckId(null)}
        >
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="commander-picker-title"
            className="w-full max-w-lg rounded-2xl border border-slate-700 bg-[#10141d] p-5 shadow-2xl"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="mb-4 flex items-start justify-between gap-4">
              <div>
                <h2 id="commander-picker-title" className="text-lg font-semibold text-white">Aseta commander</h2>
                <p className="mt-1 text-sm text-slate-400">Valitse kortti pakasta {commanderPickerDeck.name}.</p>
              </div>
              <button
                type="button"
                onClick={() => setCommanderPickerDeckId(null)}
                aria-label="Sulje commander-valinta"
                className="rounded-lg bg-slate-800 p-2 text-slate-200 hover:bg-slate-700"
              >
                <X size={18} />
              </button>
            </div>
            {commanderPickerDeck.commanderCardId && (
              <button
                type="button"
                onClick={() => void setDeckCommander(commanderPickerDeck.id, null)}
                className="mb-3 w-full rounded-lg border border-slate-700 px-3 py-2 text-left text-sm text-slate-300 hover:border-violet-500 hover:bg-slate-900"
              >
                Poista nykyinen commander
              </button>
            )}
            <div className="max-h-[55dvh] space-y-2 overflow-y-auto">
              {commanderPickerDeck.cards.map((entry) => (
                <button
                  key={entry.cardId}
                  type="button"
                  onClick={() => void setDeckCommander(commanderPickerDeck.id, entry.cardId)}
                  aria-pressed={commanderPickerDeck.commanderCardId === entry.cardId}
                  className={`flex w-full items-center justify-between gap-3 rounded-xl border px-3 py-2 text-left ${
                    commanderPickerDeck.commanderCardId === entry.cardId
                      ? 'border-violet-500 bg-violet-500/10'
                      : 'border-slate-700 bg-slate-900 hover:border-violet-500'
                  }`}
                >
                  <span className="min-w-0">
                    <span className="block truncate font-medium text-white">{entry.card.name}</span>
                    <span className="block truncate text-xs text-slate-400">{entry.card.type_line}</span>
                  </span>
                  {commanderPickerDeck.commanderCardId === entry.cardId && <Crown size={17} className="shrink-0 text-violet-300" />}
                </button>
              ))}
            </div>
          </section>
        </div>
      )}

      {previewCard && (
        <div
          className="fixed inset-0 z-[70] flex items-center justify-center bg-black/85 p-4 backdrop-blur-sm"
          role="presentation"
          onClick={closeCardPreview}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label={`${previewCard.name} korttikuva`}
            className="relative flex max-h-[90dvh] w-full max-w-[min(90vw,40rem)] touch-pan-y items-center justify-center"
            onClick={(event) => event.stopPropagation()}
            onTouchStart={(event) => {
              touchStartX.current = event.touches[0]?.clientX ?? null;
            }}
            onTouchEnd={(event) => {
              const startX = touchStartX.current;
              const endX = event.changedTouches[0]?.clientX;
              touchStartX.current = null;
              if (startX === null || endX === undefined) return;
              const deltaX = endX - startX;
              if (Math.abs(deltaX) < 50) return;
              if (deltaX < 0 && previewCardIndex < previewCards.length - 1) {
                setPreviewCard(previewCards[previewCardIndex + 1]);
              } else if (deltaX > 0 && previewCardIndex > 0) {
                setPreviewCard(previewCards[previewCardIndex - 1]);
              }
            }}
          >
            <button
              type="button"
              onClick={closeCardPreview}
              aria-label="Sulje kortin esikatselu"
              className="absolute -right-2 -top-2 z-10 rounded-full border border-slate-600 bg-slate-900 p-2 text-white shadow-lg hover:bg-slate-800"
            >
              <X size={20} />
            </button>
            {previewCards.length > 1 && (
              <>
                <button
                  type="button"
                  onClick={() => {
                    if (previewCardIndex > 0) setPreviewCard(previewCards[previewCardIndex - 1]);
                  }}
                  aria-label="Edellinen kortti"
                  disabled={previewCardIndex <= 0}
                  className="absolute left-0 z-10 rounded-full border border-slate-600 bg-slate-900/90 p-2 text-white shadow-lg hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-40 sm:-left-2 sm:p-3"
                >
                  <ChevronLeft size={24} />
                </button>
                <button
                  type="button"
                  onClick={() => {
                    if (previewCardIndex >= 0 && previewCardIndex < previewCards.length - 1) {
                      setPreviewCard(previewCards[previewCardIndex + 1]);
                    }
                  }}
                  aria-label="Seuraava kortti"
                  disabled={previewCardIndex < 0 || previewCardIndex >= previewCards.length - 1}
                  className="absolute right-0 z-10 rounded-full border border-slate-600 bg-slate-900/90 p-2 text-white shadow-lg hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-40 sm:-right-2 sm:p-3"
                >
                  <ChevronRight size={24} />
                </button>
              </>
            )}
            <img
              src={getCardImageUrl(previewCard, 'large') ?? getCardImageUrl(previewCard, 'normal') ?? 'https://placehold.co/672x936/111827/9ca3af?text=MTG'}
              alt={previewCard.name}
              className="max-h-[88dvh] w-auto max-w-[min(75vw,32rem)] rounded-2xl object-contain shadow-2xl"
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
                          setSelectedPrinting(printing);
                          openCardPreview(printing, 'printings');
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
                        onClick={() => setSelectedPrinting(printing)}
                        aria-pressed={isSelected}
                        className="mt-2 block w-full text-left"
                      >
                        <span className="block truncate text-sm font-medium text-white">
                          {printing.set_name ?? printing.set.toUpperCase()}
                        </span>
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
