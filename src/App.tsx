import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowRightLeft,
  ArrowUpDown,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Crown,
  Copy,
  Download,
  FolderPlus,
  Heart,
  Info,
  LayoutGrid,
  Layers,
  Library,
  List,
  MoreHorizontal,
  MoreVertical,
  Minus,
  Pencil,
  Plus,
  RefreshCw,
  RotateCw,
  Save,
  Search,
  Shield,
  SlidersHorizontal,
  Trash2,
  Undo2,
  Upload,
  X,
} from 'lucide-react';
import { db, importAllData } from './db';
import {
  autocompleteCardName,
  fetchCardRulings,
  fetchCardSymbolUris,
  fetchCardsBatch,
  getCardImageUrl,
  searchCardPrintings,
  searchCards,
  type CardRuling,
} from './services/scryfall';
import type { CollectionCard, Deck, DeckCard, MtgCard, WishlistCard } from './types';
import {
  formatArenaExport,
  parseCsvImport,
  parseDecklistText,
  parseJsonImport,
  type ParsedDeckEntry,
} from './utils/decklist';
import { config } from './config.js';
import { ManaCurve } from './components/ManaCurve';
import { formatCardPrice } from './utils/deckStats';
import { SampleHandModal } from './components/SampleHandModal';
import { CardInfoModal } from './components/CardInfoModal';
import { PrintingsModal } from './components/PrintingsModal';
import { CollectionImportModal } from './components/CollectionImportModal';

const tabs = [
  { id: 'decks', label: 'Pakat', icon: Layers },
  { id: 'collection', label: 'Kokoelma', icon: Library },
  { id: 'wishlist', label: 'Toivelista', icon: Heart },
  { id: 'search', label: 'Korttihaku', icon: Search },
  { id: 'import', label: 'Tuo / Vie', icon: ArrowUpDown },
] as const;

function readCardViewPreference(): 'list' | 'grid' {
  try {
    return (window.localStorage.getItem('mtg-apuri-card-view') || window.localStorage.getItem('ez-mtg-card-view')) === 'grid' ? 'grid' : 'list';
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
  const selectedFace = card.card_faces?.[card.selected_face_index ?? 0];
  const manaCost = selectedFace?.mana_cost ?? card.mana_cost ?? card.card_faces?.[0]?.mana_cost;
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
  rarity: string;
  edition: string;
  releaseYear: string;
};

type CardSortKey = 'name' | 'manaValue' | 'price' | 'addedAt';
type DeckSortKey = 'name' | 'createdAt';
type SortDirection = 'asc' | 'desc';

function getCardNumericPrice(card: MtgCard): number {
  const pStr = card.prices?.eur || card.prices?.eur_foil;
  if (pStr) {
    const val = parseFloat(pStr);
    if (!isNaN(val)) return val;
  }
  const uStr = card.prices?.usd || card.prices?.usd_foil;
  if (uStr) {
    const val = parseFloat(uStr);
    if (!isNaN(val)) return val;
  }
  return -1;
}

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
    } else if (sortKey === 'price') {
      const leftPrice = getCardNumericPrice(left.card);
      const rightPrice = getCardNumericPrice(right.card);
      if (leftPrice < 0 && rightPrice >= 0) return 1;
      if (leftPrice >= 0 && rightPrice < 0) return -1;
      comparison = leftPrice - rightPrice;
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
  rarity: '',
  edition: '',
  releaseYear: '',
};

const emptyDeckCards: DeckCard[] = [];

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
  if (filters.rarity && card.rarity.toLowerCase() !== filters.rarity) return false;
  if (filters.edition) {
    const edition = `${card.set_name ?? ''} ${card.set}`.toLocaleLowerCase();
    if (!edition.includes(filters.edition.trim().toLocaleLowerCase())) return false;
  }
  if (filters.releaseYear && card.released_at?.slice(0, 4) !== filters.releaseYear) return false;

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
  const typeLine = (card.card_faces?.[card.selected_face_index ?? 0]?.type_line ?? card.type_line).toLowerCase();
  return deckCardCategories.find((category) => category.id !== 'other' && typeLine.includes(category.id))?.id ?? 'other';
}

function getCardStats(card: MtgCard) {
  const face = card.card_faces?.[card.selected_face_index ?? 0];
  const power = face?.power ?? card.power;
  const toughness = face?.toughness ?? card.toughness;
  if (power !== undefined && toughness !== undefined) return `${power}/${toughness}`;
  const loyalty = face?.loyalty ?? card.loyalty;
  if (loyalty !== undefined) return `Uskollisuus ${loyalty}`;
  const defense = face?.defense ?? card.defense;
  if (defense !== undefined) return `Puolustus ${defense}`;
  return null;
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
                if (value === 'name' || value === 'manaValue' || value === 'price' || value === 'addedAt') {
                  onSortKeyChange(value);
                }
              }}
              aria-label="Järjestä kortit"
              className="max-w-36 rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-2 text-sm text-slate-200 focus:border-violet-500 focus:outline-none"
            >
              <option value="name">Nimi</option>
              <option value="manaValue">Manan arvo</option>
              <option value="price">Hinta</option>
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
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
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
        <label className="grid gap-1 text-xs text-slate-400">
          Harvinaisuus
          <select
            value={filters.rarity}
            onChange={(event) => onChange({ ...filters, rarity: event.target.value })}
            className={fieldClass}
          >
            <option value="">Kaikki harvinaisuudet</option>
            <option value="common">Common</option>
            <option value="uncommon">Uncommon</option>
            <option value="rare">Rare</option>
            <option value="mythic">Mythic</option>
            <option value="special">Special</option>
            <option value="bonus">Bonus</option>
          </select>
        </label>
        <label className="grid gap-1 text-xs text-slate-400">
          Painos
          <input
            type="search"
            placeholder="Nimi tai koodi"
            value={filters.edition}
            onChange={(event) => onChange({ ...filters, edition: event.target.value })}
            className={fieldClass}
          />
        </label>
        <label className="grid gap-1 text-xs text-slate-400">
          Julkaisuvuosi
          <input
            type="number"
            min="1993"
            max="2100"
            placeholder="Kaikki"
            value={filters.releaseYear}
            onChange={(event) => onChange({ ...filters, releaseYear: event.target.value })}
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
  const [wishlist, setWishlist] = useState<WishlistCard[]>([]);
  const [pendingWishlistRemovals, setPendingWishlistRemovals] = useState<Map<string, WishlistCard>>(() => new Map());
  const [cardView, setCardView] = useState<'list' | 'grid'>(readCardViewPreference);
  const [deckFilters, setDeckFilters] = useState<CardFilters>(emptyCardFilters);
  const [collectionFilters, setCollectionFilters] = useState<CardFilters>(emptyCardFilters);
  const [searchFilters, setSearchFilters] = useState<CardFilters>(emptyCardFilters);
  const [deckSearch, setDeckSearch] = useState('');
  const [collectionSearch, setCollectionSearch] = useState('');
  const [dirtyDeckIds, setDirtyDeckIds] = useState<Set<string>>(() => new Set());
  const [dirtyCollectionIds, setDirtyCollectionIds] = useState<Set<string>>(() => new Set());
  const [deckPickerOpen, setDeckPickerOpen] = useState(false);
  const [showInactiveDecks, setShowInactiveDecks] = useState(false);
  const [deckSortKey, setDeckSortKey] = useState<DeckSortKey>('name');
  const [deckSortDirection, setDeckSortDirection] = useState<SortDirection>('asc');
  const [deckCardSortKey, setDeckCardSortKey] = useState<CardSortKey>('name');
  const [deckCardSortDirection, setDeckCardSortDirection] = useState<SortDirection>('asc');
  const [deckFormatInput, setDeckFormatInput] = useState('');
  const [sideboardOpen, setSideboardOpen] = useState(false);
  const [openDeckCardMenuId, setOpenDeckCardMenuId] = useState<string | null>(null);
  const [openCardActionMenuKey, setOpenCardActionMenuKey] = useState<string | null>(null);
  const [openCardActionDeckMenuKey, setOpenCardActionDeckMenuKey] = useState<string | null>(null);
  const [cardMoveRequest, setCardMoveRequest] = useState<{ deckId: string; entry: DeckCard } | null>(null);
  const [faceChangeRequest, setFaceChangeRequest] = useState<{
    source: 'deck' | 'collection' | 'search' | 'wishlist';
    deckId?: string;
    cardId?: string;
    card: MtgCard;
    faceIndex: number;
    confirm: boolean;
  } | null>(null);
  const [cardInfoEntry, setCardInfoEntry] = useState<DeckCard | null>(null);
  const [cardRulings, setCardRulings] = useState<CardRuling[]>([]);
  const [cardRulingsLoading, setCardRulingsLoading] = useState(false);
  const [cardRulingsError, setCardRulingsError] = useState<string | null>(null);
  const [openDeckMenuId, setOpenDeckMenuId] = useState<string | null>(null);
  const [commanderPickerDeckId, setCommanderPickerDeckId] = useState<string | null>(null);
  const [deckNameDialog, setDeckNameDialog] = useState<
    { mode: 'create' }
    | { mode: 'rename'; deckId: string }
    | { mode: 'duplicate'; deckId: string }
    | null
  >(null);
  const [collectionSortKey, setCollectionSortKey] = useState<CardSortKey>('name');
  const [collectionSortDirection, setCollectionSortDirection] = useState<SortDirection>('asc');
  const [wishlistFilters, setWishlistFilters] = useState<CardFilters>(emptyCardFilters);
  const [wishlistSearch, setWishlistSearch] = useState('');
  const [exportFormat, setExportFormat] = useState<'json' | 'csv'>('json');
  const [exportDeckMenuOpen, setExportDeckMenuOpen] = useState(false);
  const [deckNameInput, setDeckNameInput] = useState('');
  const [selectedDeckId, setSelectedDeckId] = useState<string | null>(null);
  const [searchSortKey, setSearchSortKey] = useState<CardSortKey>('name');
  const [searchSortDirection, setSearchSortDirection] = useState<SortDirection>('asc');
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
  const [playtestDeck, setPlaytestDeck] = useState<Deck | null>(null);
  const [searchSuggestions, setSearchSuggestions] = useState<string[]>([]);
  const [showSearchSuggestions, setShowSearchSuggestions] = useState(false);
  const [autoSaveEnabled] = useState(true);
  const [collectionImportPending, setCollectionImportPending] = useState<{
    entries: ParsedDeckEntry[];
    fileName: string;
    rawCards?: MtgCard[];
  } | null>(null);
  const [collectionImportLoading, setCollectionImportLoading] = useState(false);
  const [collectionImportProgress, setCollectionImportProgress] = useState<{ current: number; total: number } | null>(null);
  const [refreshingDeckPrices, setRefreshingDeckPrices] = useState(false);
  const [refreshingAllPrices, setRefreshingAllPrices] = useState(false);
  const [refreshingAllPricesProgress, setRefreshingAllPricesProgress] = useState<{ current: number; total: number } | null>(null);
  const [deckUndoSnapshot, setDeckUndoSnapshot] = useState<{ deckId: string; deck: Deck; description: string } | null>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  const selectedDeck = decks.find((deck) => deck.id === selectedDeckId) ?? null;
  const selectedDeckCards = selectedDeck?.cards ?? emptyDeckCards;
  const commanderCardId = selectedDeck?.commanderCardId;
  const commanderPickerDeck = decks.find((deck) => deck.id === commanderPickerDeckId) ?? null;
  const visibleDecks = useMemo(() => {
    const filtered = decks.filter((deck) => showInactiveDecks || deck.active !== false);
    return filtered.sort((left, right) => {
      const comparison = deckSortKey === 'name'
        ? left.name.localeCompare(right.name, 'fi', { sensitivity: 'base' })
        : left.createdAt - right.createdAt;
      return comparison === 0 ? left.name.localeCompare(right.name, 'fi') : comparison * (deckSortDirection === 'asc' ? 1 : -1);
    });
  }, [decks, showInactiveDecks, deckSortKey, deckSortDirection]);
  const deckTotal = selectedDeck?.cards.filter((card) => !card.isSideboard).reduce((sum, card) => sum + card.count, 0) ?? 0;
  const sideboardTotal = selectedDeck?.cards.filter((card) => card.isSideboard).reduce((sum, card) => sum + card.count, 0) ?? 0;
  const collectionTotal = collection.reduce((sum, item) => sum + item.count, 0);
  const collectionTotalPriceEur = useMemo(() => {
    return collection.reduce((sum, item) => {
      const pStr = item.card.prices?.eur || item.card.prices?.eur_foil;
      const p = pStr ? parseFloat(pStr) : 0;
      return sum + (isNaN(p) ? 0 : p * item.count);
    }, 0);
  }, [collection]);
  const wishlistTotalPriceEur = useMemo(() => {
    return wishlist.reduce((sum, item) => {
      const pStr = item.card.prices?.eur || item.card.prices?.eur_foil;
      const p = pStr ? parseFloat(pStr) : 0;
      return sum + (isNaN(p) ? 0 : p);
    }, 0);
  }, [wishlist]);
  const filteredDeckCards = useMemo(
    () => {
      const query = deckSearch.trim().toLocaleLowerCase();
      return selectedDeckCards.filter(({ card, isSideboard }) => {
        const searchableText = [card.name, card.type_line, card.set_name, card.oracle_text, card.set]
          .filter(Boolean)
          .join(' ')
          .toLocaleLowerCase();
        return !isSideboard && matchesCardFilters(card, deckFilters) && (!query || searchableText.includes(query));
      }) ?? [];
    },
    [selectedDeckCards, deckFilters, deckSearch],
  );
  const filteredSideboardCards = useMemo(
    () => {
      const query = deckSearch.trim().toLocaleLowerCase();
      return selectedDeckCards.filter(({ card, isSideboard }) => {
        const searchableText = [card.name, card.type_line, card.set_name, card.oracle_text, card.set]
          .filter(Boolean)
          .join(' ')
          .toLocaleLowerCase();
        return isSideboard && matchesCardFilters(card, deckFilters) && (!query || searchableText.includes(query));
      }) ?? [];
    },
    [selectedDeckCards, deckFilters, deckSearch],
  );
  const commanderEntry = selectedDeckCards.find((entry) => !entry.isSideboard && entry.cardId === commanderCardId) ?? null;
  const sortedDeckCards = useMemo(
    () => sortCardEntries(filteredDeckCards, deckCardSortKey, deckCardSortDirection),
    [filteredDeckCards, deckCardSortKey, deckCardSortDirection],
  );
  const visibleDeckCards = useMemo(
    () => sortedDeckCards.filter((entry) => entry.cardId !== commanderCardId),
    [sortedDeckCards, commanderCardId],
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
  const sideboardDisplayItems = useMemo<DeckDisplayItem[]>(() => {
    const items: DeckDisplayItem[] = [];
    const sortedSideboard = sortCardEntries(filteredSideboardCards, deckCardSortKey, deckCardSortDirection);
    for (const category of deckCardCategories) {
      const cards = sortedSideboard.filter((entry) => getDeckCardCategory(entry.card) === category.id);
      if (cards.length === 0) continue;
      const count = cards.reduce((total, entry) => total + entry.count, 0);
      items.push({ kind: 'section', key: `sideboard-${category.id}`, title: `${category.label} (${count})` });
      items.push(...cards.map((entry) => ({ kind: 'card' as const, entry })));
    }
    return items;
  }, [filteredSideboardCards, deckCardSortKey, deckCardSortDirection]);
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
  const filteredWishlist = useMemo(() => {
    const query = wishlistSearch.trim().toLocaleLowerCase();
    return wishlist.filter(({ card }) => {
      const searchableText = [card.name, card.type_line, card.set_name, card.oracle_text, card.set]
        .filter(Boolean)
        .join(' ')
        .toLocaleLowerCase();
      return matchesCardFilters(card, wishlistFilters) && (!query || searchableText.includes(query));
    });
  }, [wishlist, wishlistFilters, wishlistSearch]);
  const sortedWishlist = useMemo(
    () => sortCardEntries(filteredWishlist, collectionSortKey, collectionSortDirection),
    [filteredWishlist, collectionSortKey, collectionSortDirection],
  );
  const collectionCardIds = useMemo(() => new Set(collection.map((item) => item.id)), [collection]);
  const wishlistCardIds = useMemo(() => new Set(wishlist.map((item) => item.id)), [wishlist]);
  const importEntries = useMemo(() => parseDecklistText(importText), [importText]);
  const filteredSearchResults = useMemo(
    () => searchResults.filter((card) => matchesCardFilters(card, searchFilters)),
    [searchResults, searchFilters],
  );
  const sortedSearchResults = useMemo(
    () => sortCardEntries(filteredSearchResults.map((card) => ({ card })), searchSortKey, searchSortDirection).map((e) => e.card),
    [filteredSearchResults, searchSortKey, searchSortDirection],
  );
  const visibleFilteredSearchResults = useMemo(
    () => sortedSearchResults.slice(0, visibleSearchCount),
    [sortedSearchResults, visibleSearchCount],
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
    if (tab === 'wishlist') return sortedWishlist.map((entry) => entry.card);
    return [];
  }, [previewSource, printings, tab, visibleFilteredSearchResults, selectedSearchFaces, commanderEntry, visibleDeckCards, sortedCollection, sortedWishlist]);
  const previewCardIndex = previewCards.findIndex((card) => card.id === previewCard?.id);
  const touchStartX = useRef<number | null>(null);

  useEffect(() => {
    if (!toast) return;
    const timeout = window.setTimeout(() => setToast(null), 3000);
    return () => window.clearTimeout(timeout);
  }, [toast]);

  useEffect(() => {
    if (!cardInfoEntry) return;

    let cancelled = false;
    fetchCardRulings(cardInfoEntry.card)
      .then((rulings) => {
        if (!cancelled) setCardRulings(rulings);
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        console.error('Kortin sääntöhuomioita ei voitu hakea:', error);
        setCardRulingsError('Sääntöhuomioita ei voitu hakea. Kortin muut tiedot ovat silti käytettävissä.');
      })
      .finally(() => {
        if (!cancelled) setCardRulingsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [cardInfoEntry]);

  useEffect(() => {
    try {
      window.localStorage.setItem('mtg-apuri-card-view', cardView);
    } catch (error) {
      console.error('Korttinäkymän asetusta ei voitu tallentaa:', error);
    }
  }, [cardView]);

  useEffect(() => {
    if (tab === 'search') searchInputRef.current?.focus();
  }, [tab]);

  useEffect(() => {
    const closeMenusOnOutsideClick = (event: PointerEvent) => {
      if (!(event.target instanceof Element)) return;
      if (!event.target.closest('[data-card-menu]')) {
        setOpenCardActionMenuKey(null);
        setOpenCardActionDeckMenuKey(null);
        setOpenDeckCardMenuId(null);
      }
      if (!event.target.closest('[data-deck-menu]')) setOpenDeckMenuId(null);
      if (!event.target.closest('[data-export-menu]')) setExportDeckMenuOpen(false);
    };
    document.addEventListener('pointerdown', closeMenusOnOutsideClick);
    return () => document.removeEventListener('pointerdown', closeMenusOnOutsideClick);
  }, []);

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

  const refreshWishlist = async () => {
    const items = await db.wishlist.orderBy('addedAt').reverse().toArray();
    setWishlist(items);
  };

  useEffect(() => {
    void refreshDecks();
    void refreshCollection();
    void refreshWishlist();
    fetchCardSymbolUris()
      .then(setSymbolUris)
      .catch((error: unknown) => {
        console.error('Virallisten korttisymbolien lataus epäonnistui:', error);
      });
  }, []);

  useEffect(() => {
    if (!previewCard && !printingCard && !pendingDeckCard && !deckNameDialog && !commanderPickerDeckId
      && !cardMoveRequest && !faceChangeRequest && !cardInfoEntry) return;

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
        setCardMoveRequest(null);
        setFaceChangeRequest(null);
        setCardInfoEntry(null);
      }
    };
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', closeOnEscape);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', closeOnEscape);
    };
  }, [previewCard, previewCardIndex, previewCards, printingCard, pendingDeckCard, deckNameDialog, commanderPickerDeckId, cardMoveRequest, faceChangeRequest, cardInfoEntry]);

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

  // Autocomplete suggestion dropdown effect
  useEffect(() => {
    const trimmed = searchTerm.trim();
    if (trimmed.length < 2) {
      setSearchSuggestions([]);
      return;
    }
    let cancelled = false;
    const timer = window.setTimeout(async () => {
      const suggestions = await autocompleteCardName(trimmed);
      if (!cancelled) {
        setSearchSuggestions(suggestions.slice(0, 8));
      }
    }, 150);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [searchTerm]);

  // Warn before leaving if unsaved changes exist
  useEffect(() => {
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      if (dirtyDeckIds.size > 0 || dirtyCollectionIds.size > 0) {
        event.preventDefault();
        event.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [dirtyDeckIds, dirtyCollectionIds]);

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
      format: deckFormatInput.trim() || undefined,
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
    setDeckFormatInput('');
    setStatus(`Pakka "${name}" luotu.`);
    setToast(`Pakka "${name}" luotu.`);
  };

  const openCreateDeckDialog = () => {
    setDeckNameInput('');
    setDeckFormatInput('');
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
    const copiedCardCounts = new Map<string, { card: MtgCard; count: number }>();
    for (const entry of copiedDeck.cards) {
      const current = copiedCardCounts.get(entry.card.id);
      copiedCardCounts.set(entry.card.id, { card: entry.card, count: (current?.count ?? 0) + entry.count });
    }
    for (const { card, count } of copiedCardCounts.values()) await ensureCardInCollection(card, count);
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

  const toggleDeckActive = async (deck: Deck) => {
    const active = deck.active === false;
    try {
      await db.decks.update(deck.id, { active });
      setDecks((current) => current.map((item) => item.id === deck.id ? { ...item, active } : item));
      if (!active && selectedDeckId === deck.id) {
        const nextActiveDeck = decks.find((item) => item.id !== deck.id && item.active !== false);
        setSelectedDeckId(nextActiveDeck?.id ?? null);
      }
      setOpenDeckMenuId(null);
      setStatus(`Pakka ${active ? 'aktivoitu' : 'piilotettu ei-aktiiviseksi'}.`);
    } catch (error) {
      console.error('Pakan aktiivisuustilan tallennus epäonnistui:', error);
      setStatus('Pakan aktiivisuustilaa ei voitu tallentaa.');
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

  const saveDeckUndoSnapshot = (deck: Deck, description: string) => {
    setDeckUndoSnapshot({
      deckId: deck.id,
      deck: {
        ...deck,
        cards: deck.cards.map((c) => ({ ...c, card: { ...c.card } })),
      },
      description,
    });
  };

  const undoLastDeckChange = async () => {
    if (!deckUndoSnapshot) return;
    const { deck: restoredDeck, description } = deckUndoSnapshot;

    try {
      await db.decks.put(restoredDeck);
      setDecks((prev) => prev.map((d) => (d.id === restoredDeck.id ? restoredDeck : d)));
      setDeckUndoSnapshot(null);
      const msg = `Kumottiin: ${description}. Pakka "${restoredDeck.name}" palautettu aiempaan tilaan.`;
      setStatus(msg);
      setToast(msg);
    } catch (err) {
      console.error('Pakan palautus epäonnistui:', err);
      setStatus('Pakan palautus epäonnistui.');
      setToast('Pakan palautus epäonnistui.');
    }
  };

  const saveCollectionChanges = async () => {
    if (dirtyCollectionIds.size === 0) return;

    const dirtyIds = [...dirtyCollectionIds];
    const collectionById = new Map(collection.map((item) => [item.id, item]));
    await db.transaction('rw', db.collection, db.wishlist, async () => {
      for (const id of dirtyIds) {
        const item = collectionById.get(id);
        if (item) {
          await db.collection.put(item);
        } else {
          await db.collection.delete(id);
        }
      }
      for (const id of pendingWishlistRemovals.keys()) {
        await db.wishlist.delete(id);
      }
    });
    setDirtyCollectionIds(new Set());
    setPendingWishlistRemovals(new Map());
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
      if (pendingWishlistRemovals.size > 0) {
        setWishlist((current) => [
          ...pendingWishlistRemovals.values(),
          ...current.filter((item) => !pendingWishlistRemovals.has(item.id)),
        ]);
        setPendingWishlistRemovals(new Map());
      }
      setDirtyCollectionIds(new Set());
      setStatus('Kokoelman muutokset peruutettu.');
    } catch (error) {
      console.error('Kokoelman muutosten peruminen epäonnistui:', error);
      setStatus('Kokoelman muutoksia ei voitu perua.');
    }
  };

  // Autosave effect (debounced 2.5s)
  useEffect(() => {
    if (!autoSaveEnabled) return;
    if (dirtyDeckIds.size === 0 && dirtyCollectionIds.size === 0 && pendingWishlistRemovals.size === 0) return;

    const timer = window.setTimeout(() => {
      if (dirtyDeckIds.size > 0) {
        void saveDeckChanges();
      }
      if (dirtyCollectionIds.size > 0 || pendingWishlistRemovals.size > 0) {
        void saveCollectionChanges();
      }
    }, 2500);

    return () => window.clearTimeout(timer);
  }, [dirtyDeckIds, dirtyCollectionIds, pendingWishlistRemovals, autoSaveEnabled, decks, collection]);

  const navigateToTab = (nextTab: (typeof tabs)[number]['id']) => {
    setTab(nextTab);
  };

  const ensureCardInCollection = async (card: MtgCard, count = 1) => {
    if (collection.some((item) => item.id === card.id)) return;
    if (!dirtyCollectionIds.has(card.id) && await db.collection.get(card.id)) return;
    await updateCollectionCard(card, count);
  };

  const addCardToDeck = async (
    card: MtgCard,
    count = 1,
    targetDeckId = selectedDeckId,
    targetCardId = card.id,
  ) => {
    if (!targetDeckId) {
      setStatus('Luo ensin pakka');
      setToast('Luo ensin pakka, jotta voit lisätä kortin.');
      return;
    }

    const deck = decks.find((item) => item.id === targetDeckId);
    if (!deck) return;

    saveDeckUndoSnapshot(deck, `${card.name} (${count > 0 ? '+1' : '-1'})`);

    const nextCards = [...deck.cards];
    const existingIndex = nextCards.findIndex((entry) => entry.cardId === targetCardId);

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
      nextCards.push({ cardId: targetCardId, card, count, addedAt: Date.now(), isSideboard: false });
    }

    const updatedDeck = {
      ...deck,
      cards: nextCards,
      commanderCardId: nextCards.some((entry) => entry.cardId === deck.commanderCardId)
        ? deck.commanderCardId
        : undefined,
    };
    await updateDeck(updatedDeck);
    if (count > 0) await ensureCardInCollection(card, count);
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
      const removedWishItem = pendingWishlistRemovals.get(card.id);
      if (removedWishItem) {
        setWishlist((current) => [removedWishItem, ...current.filter((item) => item.id !== card.id)]);
        setPendingWishlistRemovals((current) => {
          const next = new Map(current);
          next.delete(card.id);
          return next;
        });
      }
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
    if (change > 0 && !pendingWishlistRemovals.has(card.id)) {
      let wishItem = wishlist.find((item) => item.id === card.id);
      try {
        wishItem ??= await db.wishlist.get(card.id);
      } catch (error) {
        console.error('Kortin toivelistatietoa ei voitu tarkistaa:', error);
        setStatus('Toivelistaa ei voitu tarkistaa kokoelmaan lisäämisen yhteydessä.');
      }
      if (wishItem) {
        setPendingWishlistRemovals((current) => new Map(current).set(card.id, wishItem));
        setWishlist((current) => current.filter((item) => item.id !== card.id));
      }
    }
    const message = change > 0
      ? `${card.name} lisätty kokoelmaan. Muista tallentaa muutokset.`
      : `${card.name}: tallentamattomia muutoksia kokoelmassa.`;
    setStatus(message);
    if (change > 0) setToast(message);
  };

  const toggleWishlistCard = async (card: MtgCard) => {
    const existing = wishlist.find((item) => item.id === card.id);
    try {
      if (existing) {
        await db.wishlist.delete(card.id);
        setWishlist((current) => current.filter((item) => item.id !== card.id));
        setPendingWishlistRemovals((current) => {
          const next = new Map(current);
          next.delete(card.id);
          return next;
        });
        setStatus(`${card.name} poistettu toivelistalta.`);
      } else {
        const item: WishlistCard = { id: card.id, card, addedAt: Date.now() };
        await db.wishlist.put(item);
        setWishlist((current) => [item, ...current.filter((entry) => entry.id !== card.id)]);
        setPendingWishlistRemovals((current) => {
          const next = new Map(current);
          next.delete(card.id);
          return next;
        });
        setStatus(`${card.name} lisätty toivelistalle.`);
        setToast(`${card.name} lisätty toivelistalle.`);
      }
    } catch (error) {
      console.error('Toivelistan päivitys epäonnistui:', error);
      setStatus('Toivelistan päivitys epäonnistui.');
    }
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

  const handleCopyArenaExport = async (deck: Deck) => {
    try {
      const arenaText = formatArenaExport(deck.name, deck.cards, deck.commanderCardId);
      await navigator.clipboard.writeText(arenaText);
      const msg = `Pakka "${deck.name}" kopioitu leikepöydälle Arena-muodossa!`;
      setToast(msg);
      setStatus(msg);
    } catch (err) {
      console.error('Leikepöydälle kopiointi epäonnistui:', err);
      setStatus('Kopiointi leikepöydälle epäonnistui.');
    }
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

    saveDeckUndoSnapshot(deck, `Korttien lisäys (${entries.length} kpl)`);

    const identifiers = entries.map((entry) => {
      if (entry.set && entry.collector_number) {
        return { set: entry.set, collector_number: entry.collector_number };
      }
      return { name: entry.name };
    });

    const { found } = await fetchCardsBatch(identifiers);
    const foundByName = new Map<string, MtgCard>();
    const foundBySetNumber = new Map<string, MtgCard>();

    for (const card of found) {
      foundByName.set(card.name.toLowerCase(), card);
      foundBySetNumber.set(`${card.set.toLowerCase()}:${card.collector_number.toLowerCase()}`, card);
    }

    const nextCards = [...deck.cards];
    const importedCardCounts = new Map<string, { card: MtgCard; count: number }>();

    for (const entry of entries) {
      let card: MtgCard | undefined;
      if (entry.set && entry.collector_number) {
        card = foundBySetNumber.get(`${entry.set.toLowerCase()}:${entry.collector_number.toLowerCase()}`);
      }
      if (!card) {
        card = foundByName.get(entry.name.toLowerCase());
      }
      if (!card) continue;

      const imported = importedCardCounts.get(card.id);
      importedCardCounts.set(card.id, { card, count: (imported?.count ?? 0) + entry.count });

      const isSideboard = Boolean(entry.isSideboard);
      const existingIndex = nextCards.findIndex(
        (item) => item.cardId === card.id && Boolean(item.isSideboard) === isSideboard
      );

      if (existingIndex >= 0) {
        nextCards[existingIndex] = {
          ...nextCards[existingIndex],
          count: nextCards[existingIndex].count + entry.count,
        };
      } else {
        nextCards.push({
          cardId: card.id,
          card,
          count: entry.count,
          addedAt: Date.now(),
          isSideboard,
        });
      }
    }

    for (const { card, count } of importedCardCounts.values()) await ensureCardInCollection(card, count);
    await updateDeck({ ...deck, cards: nextCards });
    const sbCount = entries.filter((e) => e.isSideboard).length;
    const msg = `Tuotiin ${entries.length} korttiriviä pakkaan ${deck.name}${sbCount > 0 ? ` (${sbCount} sideboardiin)` : ''}.`;
    setStatus(msg);
    setToast(msg);
  };

  const importAsNewDeck = async (entries: ParsedDeckEntry[], suggestedName?: string) => {
    if (!entries.length) {
      setStatus('Ei kortteja tuotavaksi.');
      setToast('Ei kortteja tuotavaksi.');
      return;
    }

    setStatus('Haetaan kortteja Scryfallista uuteen pakkaan…');
    setToast('Haetaan kortteja Scryfallista…');

    try {
      const identifiers = entries.map((entry) => {
        if (entry.scryfall_id) return { id: entry.scryfall_id };
        if (entry.set && entry.collector_number) {
          return { set: entry.set, collector_number: entry.collector_number };
        }
        return { name: entry.name };
      });

      const { found } = await fetchCardsBatch(identifiers);
      const cardsById = new Map<string, MtgCard>(found.map((c) => [c.id, c]));
      const cardsByName = new Map<string, MtgCard>(found.map((c) => [c.name.toLowerCase(), c]));
      const cardsBySetNumber = new Map<string, MtgCard>(
        found.map((c) => [`${c.set.toLowerCase()}:${c.collector_number.toLowerCase()}`, c]),
      );

      const nextCards: DeckCard[] = [];
      const importedCardCounts = new Map<string, { card: MtgCard; count: number }>();
      let commanderCandidateId: string | undefined;

      for (const entry of entries) {
        const card =
          (entry.scryfall_id && cardsById.get(entry.scryfall_id)) ||
          (entry.set && entry.collector_number && cardsBySetNumber.get(`${entry.set.toLowerCase()}:${entry.collector_number.toLowerCase()}`)) ||
          cardsByName.get(entry.name.toLowerCase());

        if (!card) continue;

        const isSideboard = Boolean(entry.isSideboard);
        if (entry.isCommander && !commanderCandidateId) {
          commanderCandidateId = card.id;
        }

        const existingIndex = nextCards.findIndex(
          (item) => item.cardId === card.id && Boolean(item.isSideboard) === isSideboard,
        );

        if (existingIndex >= 0) {
          nextCards[existingIndex] = {
            ...nextCards[existingIndex],
            count: nextCards[existingIndex].count + entry.count,
          };
        } else {
          nextCards.push({
            cardId: card.id,
            card,
            count: entry.count,
            addedAt: Date.now(),
            isSideboard,
          });
        }

        const imported = importedCardCounts.get(card.id);
        importedCardCounts.set(card.id, { card, count: (imported?.count ?? 0) + entry.count });
      }

      if (nextCards.length === 0) {
        setStatus('Kortteja ei löytynyt Scryfallista.');
        setToast('Kortteja ei löytynyt Scryfallista.');
        return;
      }

      if (!commanderCandidateId) {
        const firstLegendary = nextCards.find((c) => !c.isSideboard && c.card.type_line?.toLowerCase().includes('legendary creature'));
        if (firstLegendary && nextCards.reduce((s, c) => s + c.count, 0) >= 60) {
          commanderCandidateId = firstLegendary.cardId;
        }
      }

      const defaultName = suggestedName?.trim()
        ? suggestedName.trim()
        : commanderCandidateId
          ? `${cardsById.get(commanderCandidateId)?.name ?? 'Commander'} -pakka`
          : `Tuotu pakka ${new Date().toLocaleDateString('fi-FI')}`;

      const now = Date.now();
      const newDeck: Deck = {
        id: crypto.randomUUID(),
        name: defaultName,
        format: commanderCandidateId ? 'Commander' : 'Standard',
        cards: nextCards,
        commanderCardId: commanderCandidateId,
        createdAt: now,
        updatedAt: now,
        active: true,
      };

      await db.decks.put(newDeck);
      setDecks((prev) => [newDeck, ...prev]);
      setSelectedDeckId(newDeck.id);

      // Ensure all cards in the newly created deck are added to the collection!
      for (const { card, count } of importedCardCounts.values()) {
        await ensureCardInCollection(card, count);
      }

      const totalCount = nextCards.reduce((s, c) => s + c.count, 0);
      const msg = `Uusi pakka "${newDeck.name}" luotu tuonnista (${totalCount} korttia)! Kortit lisätty kokoelmaan.`;
      setStatus(msg);
      setToast(msg);
      setImportText('');
      setTab('decks');
    } catch (err) {
      console.error('Uuden pakan tuonti epäonnistui:', err);
      setStatus('Uuden pakan tuonti epäonnistui.');
      setToast('Uuden pakan tuonti epäonnistui.');
    }
  };

  const handleExport = (scope: 'all' | 'deck' | 'collection', deck?: Deck) => {
    const now = Date.now();
    const payload = scope === 'deck' && deck
      ? { version: 2, exportedAt: now, decks: [deck], collection: [], wishlist: [] }
      : scope === 'collection'
        ? { version: 2, exportedAt: now, decks: [], collection, wishlist: [] }
        : { version: 2, exportedAt: now, decks, collection, wishlist };
    let content: string;
    let mimeType: string;
    let extension: string;
    if (exportFormat === 'json') {
      content = JSON.stringify(payload, null, 2);
      mimeType = 'application/json';
      extension = 'json';
    } else {
      const rows: string[][] = [];
      const addCardRow = (count: number, card: MtgCard, area: string, deckName = '') => {
        rows.push([
          String(count),
          card.name,
          card.set.toUpperCase(),
          card.set_name ?? '',
          card.collector_number,
          area,
          deckName,
        ]);
      };
      if (scope !== 'collection') {
        for (const item of payload.decks) {
          for (const entry of item.cards) addCardRow(entry.count, entry.card, entry.isSideboard ? 'Sideboard' : 'Pakassa', item.name);
        }
      }
      if (scope !== 'deck') {
        for (const item of payload.collection) addCardRow(item.count, item.card, 'Kokoelma');
        if (scope === 'all') {
          for (const item of payload.wishlist) addCardRow(1, item.card, 'Toivelista');
        }
      }
      content = [
        ['Määrä', 'Kortti', 'Settikoodi', 'Painos', 'Keräilynumero', 'Sijainti', 'Pakka'].join(','),
        ...rows.map((row) => row.map((value) => `"${value.replaceAll('"', '""')}"`).join(',')),
      ].join('\r\n');
      mimeType = 'text/csv;charset=utf-8';
      extension = 'csv';
    }
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `mtg-apuri-${scope === 'deck' ? (deck?.name ?? 'pakka').toLowerCase().replace(/[^a-z0-9-]+/g, '-') : scope}-${now}.${extension}`;
    link.click();
    URL.revokeObjectURL(url);
    setExportDeckMenuOpen(false);
    setStatus(`${scope === 'deck' ? `Pakan ${deck?.name ?? ''}` : scope === 'collection' ? 'Kokoelman' : 'Tietojen'} vienti valmis (${extension.toUpperCase()}).`);
  };

  const refreshDeckPrices = async (deckToUpdate?: Deck) => {
    const targetDeck = deckToUpdate ?? selectedDeck;
    if (!targetDeck || targetDeck.cards.length === 0) return;

    setRefreshingDeckPrices(true);
    setStatus(`Päivitetään pakan "${targetDeck.name}" hintoja Scryfallista…`);

    try {
      const chunkSize = 75;
      const allFound: MtgCard[] = [];
      const cards = targetDeck.cards;

      for (let i = 0; i < cards.length; i += chunkSize) {
        const chunk = cards.slice(i, i + chunkSize);
        const identifiers = chunk.map((c) => {
          if (c.card.id) return { id: c.card.id };
          if (c.card.set && c.card.collector_number) {
            return { set: c.card.set, collector_number: c.card.collector_number };
          }
          return { name: c.card.name };
        });
        const { found } = await fetchCardsBatch(identifiers);
        allFound.push(...found);
      }

      const foundById = new Map<string, MtgCard>(allFound.map((c) => [c.id, c]));
      const foundBySetNum = new Map<string, MtgCard>(
        allFound.map((c) => [`${c.set.toLowerCase()}:${c.collector_number.toLowerCase()}`, c]),
      );
      const foundByName = new Map<string, MtgCard>(allFound.map((c) => [c.name.toLowerCase(), c]));

      let updatedCount = 0;
      const updatedCards = targetDeck.cards.map((entry) => {
        const fresh =
          foundById.get(entry.card.id) ??
          foundBySetNum.get(`${entry.card.set.toLowerCase()}:${entry.card.collector_number.toLowerCase()}`) ??
          foundByName.get(entry.card.name.toLowerCase());

        if (fresh?.prices) {
          updatedCount++;
          return {
            ...entry,
            card: {
              ...entry.card,
              prices: fresh.prices,
            },
          };
        }
        return entry;
      });

      const updatedDeck: Deck = {
        ...targetDeck,
        cards: updatedCards,
        updatedAt: Date.now(),
      };

      await db.decks.put(updatedDeck);
      for (const c of updatedCards) {
        if (c.card.prices) {
          await db.cardCache.put({ ...c.card, cached_at: Date.now() }).catch(() => {});
        }
      }

      setDecks((prev) => prev.map((d) => (d.id === updatedDeck.id ? updatedDeck : d)));
      const msg = `Pakan "${targetDeck.name}" hinnat päivitetty (${updatedCount} korttia)!`;
      setStatus(msg);
      setToast(msg);
    } catch (err) {
      console.error('Hintojen päivitys epäonnistui:', err);
      setStatus('Hintojen päivitys epäonnistui.');
      setToast('Hintojen päivitys epäonnistui.');
    } finally {
      setRefreshingDeckPrices(false);
    }
  };

  const refreshAllPrices = async () => {
    setRefreshingAllPrices(true);
    setStatus('Päivitetään kokoelman ja pakkojen hintoja Scryfallista…');

    try {
      // 0. Make sure all cards in decks are also registered in the collection
      const existingCollectionMap = new Map<string, CollectionCard>(collection.map((c) => [c.id, c]));
      const now = Date.now();
      let addedToCollection = false;

      for (const deck of decks) {
        for (const entry of deck.cards) {
          if (!existingCollectionMap.has(entry.card.id)) {
            existingCollectionMap.set(entry.card.id, {
              id: entry.card.id,
              card: entry.card,
              count: entry.count,
              addedAt: now,
            });
            addedToCollection = true;
          }
        }
      }

      if (addedToCollection) {
        const fullCollection = Array.from(existingCollectionMap.values());
        await db.collection.bulkPut(fullCollection);
        setCollection(fullCollection);
      }

      // 1. Gather all unique cards across collection, all decks, and wishlist
      const cardMap = new Map<string, MtgCard>();
      for (const item of existingCollectionMap.values()) {
        if (item.card) cardMap.set(item.card.id, item.card);
      }
      for (const deck of decks) {
        for (const dc of deck.cards) {
          if (dc.card) cardMap.set(dc.card.id, dc.card);
        }
      }
      for (const item of wishlist) {
        if (item.card) cardMap.set(item.card.id, item.card);
      }

      const allCards = Array.from(cardMap.values());
      const totalCards = allCards.length;
      if (totalCards === 0) {
        setStatus('Ei kortteja päivitettäväksi.');
        return;
      }

      setRefreshingAllPricesProgress({ current: 0, total: totalCards });

      const chunkSize = 75;
      const allFound: MtgCard[] = [];

      for (let i = 0; i < totalCards; i += chunkSize) {
        const chunk = allCards.slice(i, i + chunkSize);
        const identifiers = chunk.map((c) => {
          if (c.id) return { id: c.id };
          if (c.set && c.collector_number) {
            return { set: c.set, collector_number: c.collector_number };
          }
          return { name: c.name };
        });

        const { found } = await fetchCardsBatch(identifiers);
        allFound.push(...found);
        setRefreshingAllPricesProgress({
          current: Math.min(i + chunkSize, totalCards),
          total: totalCards,
        });
      }

      const foundById = new Map<string, MtgCard>(allFound.map((c) => [c.id, c]));
      const foundBySetNum = new Map<string, MtgCard>(
        allFound.map((c) => [`${c.set.toLowerCase()}:${c.collector_number.toLowerCase()}`, c]),
      );
      const foundByName = new Map<string, MtgCard>(allFound.map((c) => [c.name.toLowerCase(), c]));

      const getFreshPrice = (c: MtgCard) => {
        const fresh =
          foundById.get(c.id) ??
          foundBySetNum.get(`${c.set.toLowerCase()}:${c.collector_number.toLowerCase()}`) ??
          foundByName.get(c.name.toLowerCase());
        return fresh?.prices ?? c.prices;
      };

      // 2. Update Collection
      const nextCollection = Array.from(existingCollectionMap.values()).map((item) => ({
        ...item,
        card: {
          ...item.card,
          prices: getFreshPrice(item.card),
        },
      }));
      await db.collection.bulkPut(nextCollection);
      setCollection(nextCollection);

      // 3. Update Decks
      const nextDecks = decks.map((deck) => ({
        ...deck,
        cards: deck.cards.map((entry) => ({
          ...entry,
          card: {
            ...entry.card,
            prices: getFreshPrice(entry.card),
          },
        })),
        updatedAt: Date.now(),
      }));
      await db.decks.bulkPut(nextDecks);
      setDecks(nextDecks);

      // 4. Update Wishlist
      const nextWishlist = wishlist.map((item) => ({
        ...item,
        card: {
          ...item.card,
          prices: getFreshPrice(item.card),
        },
      }));
      await db.wishlist.bulkPut(nextWishlist);
      setWishlist(nextWishlist);

      // 5. Update Card Cache
      for (const fresh of allFound) {
        await db.cardCache.put({ ...fresh, cached_at: Date.now() }).catch(() => {});
      }

      const msg = `Kaikki hinnat päivitetty (${allFound.length} / ${totalCards} korttia)!`;
      setStatus(msg);
      setToast(msg);
    } catch (err) {
      console.error('Kokoelman hintojen päivitys epäonnistui:', err);
      setStatus('Hintojen päivitys epäonnistui.');
      setToast('Hintojen päivitys epäonnistui.');
    } finally {
      setRefreshingAllPrices(false);
      setRefreshingAllPricesProgress(null);
    }
  };

  const handleFileImport = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    try {
      const raw = await file.text();

      if (file.name.toLowerCase().endsWith('.json') || raw.trim().startsWith('{') || raw.trim().startsWith('[')) {
        try {
          const parsed = JSON.parse(raw);
          if (parsed && (parsed.decks || parsed.collection || parsed.wishlist)) {
            const importedDecks: Deck[] = parsed.decks ?? [];
            await importAllData({
              version: 2,
              exportedAt: Date.now(),
              decks: importedDecks,
              collection: parsed.collection ?? [],
              wishlist: parsed.wishlist ?? [],
            }, 'merge');
            await refreshDecks();
            await refreshCollection();
            await refreshWishlist();

            // Ensure all deck cards are also in collection
            for (const d of importedDecks) {
              for (const entry of d.cards) {
                await ensureCardInCollection(entry.card, entry.count);
              }
            }

            const decksNeedPrices = importedDecks.filter((d) => d.cards.some((c) => !c.card?.prices));
            if (decksNeedPrices.length > 0) {
              setStatus('Tuonti onnistui! Haetaan puuttuvia hintoja Scryfallista…');
              setToast('Tuonti onnistui. Haetaan puuttuvia hintoja…');
              for (const deckToBackfill of decksNeedPrices) {
                await refreshDeckPrices(deckToBackfill);
              }
            } else {
              const msg = importedDecks.length > 0
                ? `Tuotiin ${importedDecks.length} pakka(a) onnistuneesti!`
                : `Tuotiin ${parsed.collection?.length ?? 0} korttia kokoelmaan!`;
              setStatus(msg);
              setToast(msg);
            }
            return;
          }
        } catch {
          // If direct JSON structure parse failed, fall through to parseJsonImport
        }

        const parsedJsonEntries = parseJsonImport(raw);
        if (parsedJsonEntries.length > 0) {
          const suggestedName = file.name.replace(/\.[^/.]+$/, '');
          await importAsNewDeck(parsedJsonEntries, suggestedName);
          return;
        }
      }

      const parsed = file.name.toLowerCase().endsWith('.csv') ? parseCsvImport(raw) : parseDecklistText(raw);
      if (parsed.length) {
        const suggestedName = file.name.replace(/\.[^/.]+$/, '');
        await importAsNewDeck(parsed, suggestedName);
      } else {
        setStatus('Tiedostosta ei löytynyt kortteja');
        setToast('Tiedostosta ei löytynyt kortteja.');
      }
    } catch (error) {
      console.error(error);
      setStatus('Tiedoston import epäonnistui');
      setToast('Tiedoston tuonti epäonnistui.');
    } finally {
      event.target.value = '';
    }
  };

  const handleCollectionFileSelect = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    try {
      const text = await file.text();
      let parsed: ParsedDeckEntry[] = [];
      const rawCards: MtgCard[] = [];

      if (file.name.toLowerCase().endsWith('.json') || text.trim().startsWith('{') || text.trim().startsWith('[')) {
        parsed = parseJsonImport(text);
        try {
          const json = JSON.parse(text);
          if (Array.isArray(json)) {
            for (const item of json) {
              if (item?.card && item.card.id) rawCards.push(item.card);
            }
          } else if (typeof json === 'object' && json !== null) {
            if (Array.isArray(json.collection)) {
              for (const item of json.collection) {
                if (item?.card && item.card.id) rawCards.push(item.card);
              }
            }
            if (Array.isArray(json.decks)) {
              for (const d of json.decks) {
                if (Array.isArray(d?.cards)) {
                  for (const c of d.cards) {
                    if (c?.card && c.card.id) rawCards.push(c.card);
                  }
                }
              }
            }
          }
        } catch {}
      } else if (file.name.toLowerCase().endsWith('.csv')) {
        parsed = parseCsvImport(text);
      } else {
        parsed = parseDecklistText(text);
      }

      if (parsed.length === 0) {
        setStatus('Tiedostosta ei löytynyt kortteja tuotavaksi.');
        setToast('Tiedostosta ei löytynyt kortteja.');
        return;
      }

      setCollectionImportPending({
        entries: parsed,
        fileName: file.name,
        rawCards: rawCards.length > 0 ? rawCards : undefined,
      });
    } catch (err) {
      console.error('Kokoelmatiedoston luku epäonnistui:', err);
      setStatus('Kokoelmatiedoston luku epäonnistui.');
      setToast('Kokoelmatiedoston luku epäonnistui.');
    } finally {
      event.target.value = '';
    }
  };

  const executeCollectionImport = async (mode: 'sync' | 'add' | 'replace') => {
    if (!collectionImportPending) return;
    const { entries, rawCards } = collectionImportPending;

    setCollectionImportLoading(true);
    setCollectionImportProgress({ current: 0, total: entries.length });

    try {
      const chunkSize = 75;
      const cardsById = new Map<string, MtgCard>();
      const cardsBySetNumber = new Map<string, MtgCard>();
      const cardsByName = new Map<string, MtgCard>();

      if (rawCards) {
        for (const card of rawCards) {
          cardsById.set(card.id, card);
          if (card.set && card.collector_number) {
            cardsBySetNumber.set(`${card.set.toLowerCase()}:${card.collector_number.toLowerCase()}`, card);
          }
          cardsByName.set(card.name.toLowerCase(), card);
          await db.cardCache.put({ ...card, cached_at: Date.now() }).catch(() => {});
        }
      }

      const entriesToFetch = entries.filter((e) => {
        if (e.scryfall_id && cardsById.has(e.scryfall_id)) return false;
        if (e.set && e.collector_number && cardsBySetNumber.has(`${e.set.toLowerCase()}:${e.collector_number.toLowerCase()}`)) return false;
        if (cardsByName.has(e.name.toLowerCase())) return false;
        return true;
      });

      if (entriesToFetch.length > 0) {
        for (let i = 0; i < entriesToFetch.length; i += chunkSize) {
          const chunk = entriesToFetch.slice(i, i + chunkSize);
          const identifiers = chunk.map((e) => {
            if (e.scryfall_id) return { id: e.scryfall_id };
            if (e.set && e.collector_number) return { set: e.set, collector_number: e.collector_number };
            return { name: e.name };
          });

          const { found } = await fetchCardsBatch(identifiers);
          for (const card of found) {
            cardsById.set(card.id, card);
            cardsBySetNumber.set(`${card.set.toLowerCase()}:${card.collector_number.toLowerCase()}`, card);
            cardsByName.set(card.name.toLowerCase(), card);
            await db.cardCache.put({ ...card, cached_at: Date.now() }).catch(() => {});
          }
          setCollectionImportProgress({ current: Math.min(i + chunkSize, entriesToFetch.length), total: entriesToFetch.length });
        }
      }

      const targetCardMap = new Map<string, { card: MtgCard; count: number }>();

      for (const entry of entries) {
        let matchedCard: MtgCard | undefined;
        if (entry.scryfall_id) {
          matchedCard = cardsById.get(entry.scryfall_id);
        }
        if (!matchedCard && entry.set && entry.collector_number) {
          matchedCard = cardsBySetNumber.get(`${entry.set.toLowerCase()}:${entry.collector_number.toLowerCase()}`);
        }
        if (!matchedCard) {
          matchedCard = cardsByName.get(entry.name.toLowerCase());
        }
        if (!matchedCard) continue;

        const current = targetCardMap.get(matchedCard.id);
        targetCardMap.set(matchedCard.id, {
          card: matchedCard,
          count: (current?.count ?? 0) + entry.count,
        });
      }

      const currentCollectionMap = new Map<string, CollectionCard>(collection.map((item) => [item.id, item]));
      let addedCount = 0;
      let updatedCount = 0;

      if (mode === 'replace') {
        await db.collection.clear();
        currentCollectionMap.clear();
      }

      const now = Date.now();
      const nextCollection: CollectionCard[] = [];

      if (mode === 'replace') {
        for (const [id, { card, count }] of targetCardMap.entries()) {
          nextCollection.push({ id, card, count, addedAt: now });
          addedCount++;
        }
      } else if (mode === 'sync') {
        for (const [id, item] of currentCollectionMap.entries()) {
          const imported = targetCardMap.get(id);
          if (imported) {
            if (item.count !== imported.count) updatedCount++;
            nextCollection.push({ ...item, count: imported.count });
            targetCardMap.delete(id);
          } else {
            nextCollection.push(item);
          }
        }
        for (const [id, { card, count }] of targetCardMap.entries()) {
          nextCollection.push({ id, card, count, addedAt: now });
          addedCount++;
        }
      } else {
        // 'add'
        for (const [id, item] of currentCollectionMap.entries()) {
          const imported = targetCardMap.get(id);
          if (imported) {
            updatedCount++;
            nextCollection.push({ ...item, count: item.count + imported.count });
            targetCardMap.delete(id);
          } else {
            nextCollection.push(item);
          }
        }
        for (const [id, { card, count }] of targetCardMap.entries()) {
          nextCollection.push({ id, card, count, addedAt: now });
          addedCount++;
        }
      }

      await db.collection.bulkPut(nextCollection);
      for (const item of nextCollection) {
        await db.cardCache.put({ ...item.card, cached_at: now }).catch(() => {});
      }

      setCollection(nextCollection);
      setDirtyCollectionIds(new Set());
      setCollectionImportPending(null);

      const summaryMessage = `Kokoelma päivitetty! Lisättiin ${addedCount} uutta korttia, päivitettiin ${updatedCount} kortin määrä.`;
      setStatus(summaryMessage);
      setToast(summaryMessage);
    } catch (err) {
      console.error('Kokoelman tuontivirhe:', err);
      setStatus('Kokoelman tuonti epäonnistui.');
      setToast('Kokoelman tuonti epäonnistui.');
    } finally {
      setCollectionImportLoading(false);
      setCollectionImportProgress(null);
    }
  };

  const moveDeckCardToSideboard = async (entry: DeckCard, isSideboard: boolean) => {
    if (!selectedDeck) return;
    saveDeckUndoSnapshot(selectedDeck, `${entry.card.name} siirto ${isSideboard ? 'sideboardiin' : 'pakan kortteihin'}`);
    if (isSideboard) await ensureCardInCollection(entry.card, entry.count);
    const cards = selectedDeck.cards.map((item) => item.cardId === entry.cardId ? { ...item, isSideboard } : item);
    await updateDeck({
      ...selectedDeck,
      cards,
      commanderCardId: isSideboard && selectedDeck.commanderCardId === entry.cardId
        ? undefined
        : selectedDeck.commanderCardId,
    });
    setOpenDeckCardMenuId(null);
    if (isSideboard) setSideboardOpen(true);
    setStatus(`${entry.card.name} siirretty ${isSideboard ? 'sideboardiin' : 'pakan kortteihin'}. Muista tallentaa muutokset.`);
  };

  const moveDeckCardToAnotherDeck = async (targetDeckId: string) => {
    if (!cardMoveRequest) return;
    const sourceDeck = decks.find((deck) => deck.id === cardMoveRequest.deckId);
    const targetDeck = decks.find((deck) => deck.id === targetDeckId);
    const movingEntry = sourceDeck?.cards.find((entry) => entry.cardId === cardMoveRequest.entry.cardId);
    if (!sourceDeck || !targetDeck || !movingEntry) {
      setStatus('Korttia tai pakkaa ei löytynyt siirtoa varten.');
      setCardMoveRequest(null);
      return;
    }

    saveDeckUndoSnapshot(sourceDeck, `${movingEntry.card.name} siirto toiseen pakkaan`);

    const sameFace = (left: DeckCard, right: DeckCard) =>
      left.card.id === right.card.id
      && (left.card.selected_face_index ?? 0) === (right.card.selected_face_index ?? 0)
      && Boolean(left.isSideboard) === Boolean(right.isSideboard);
    const matchingTarget = targetDeck.cards.find((entry) => sameFace(entry, movingEntry));
    const targetCardId = matchingTarget
      ? matchingTarget.cardId
      : targetDeck.cards.some((entry) => entry.cardId === movingEntry.cardId)
        ? crypto.randomUUID()
        : movingEntry.cardId;
    const nextTargetCards = matchingTarget
      ? targetDeck.cards.map((entry) => entry.cardId === matchingTarget.cardId
        ? { ...entry, count: entry.count + movingEntry.count }
        : entry)
      : [...targetDeck.cards, { ...movingEntry, cardId: targetCardId }];

    try {
      await updateDeck({
        ...targetDeck,
        cards: nextTargetCards,
      });
      await updateDeck({
        ...sourceDeck,
        cards: sourceDeck.cards.filter((entry) => entry.cardId !== movingEntry.cardId),
        commanderCardId: sourceDeck.commanderCardId === movingEntry.cardId
          ? undefined
          : sourceDeck.commanderCardId,
      });
      setCardMoveRequest(null);
      setOpenDeckCardMenuId(null);
      setStatus(`${movingEntry.card.name} siirretty pakkaan ${targetDeck.name}. Muista tallentaa molemmat pakat.`);
    } catch (error) {
      console.error('Kortin siirto toiseen pakkaan epäonnistui:', error);
      setStatus('Korttia ei voitu siirtää toiseen pakkaan.');
    }
  };

  const applyFaceChange = async (mode: 'replace' | 'add') => {
    if (!faceChangeRequest) return;
    const card = { ...faceChangeRequest.card, selected_face_index: faceChangeRequest.faceIndex };
    if (faceChangeRequest.source === 'deck') {
      const deck = decks.find((item) => item.id === faceChangeRequest.deckId);
      const selectedEntry = deck?.cards.find((entry) => entry.cardId === faceChangeRequest.cardId);
      if (!deck || !selectedEntry) {
        setStatus('Korttia ei löytynyt facen vaihtamista varten.');
        setFaceChangeRequest(null);
        return;
      }
      if (mode === 'replace') {
        await updateDeck({
          ...deck,
          cards: deck.cards.map((entry) => entry.cardId === selectedEntry.cardId ? { ...entry, card } : entry),
        });
        setStatus(`${card.card_faces?.[faceChangeRequest.faceIndex]?.name ?? card.name} korvasi valitun face-näkymän. Muista tallentaa muutokset.`);
      } else {
        await addCardToDeck(card, 1, deck.id, crypto.randomUUID());
        setStatus(`${card.card_faces?.[faceChangeRequest.faceIndex]?.name ?? card.name} lisätty uutena korttirivinä. Muista tallentaa muutokset.`);
      }
    } else if (faceChangeRequest.source === 'search') {
      setSelectedSearchFaces((current) => ({ ...current, [card.id]: faceChangeRequest.faceIndex }));
      setStatus(`${card.card_faces?.[faceChangeRequest.faceIndex]?.name ?? card.name} valittu.`);
    } else if (faceChangeRequest.source === 'collection') {
      setCollection((current) => current.map((item) => item.id === card.id ? { ...item, card } : item));
      setDirtyCollectionIds((current) => new Set(current).add(card.id));
      setStatus(`${card.card_faces?.[faceChangeRequest.faceIndex]?.name ?? card.name} valittu. Muista tallentaa kokoelma.`);
    } else {
      const item = wishlist.find((entry) => entry.id === card.id);
      if (item) {
        const updatedItem = { ...item, card };
        try {
          await db.wishlist.put(updatedItem);
          setWishlist((current) => current.map((entry) => entry.id === card.id ? updatedItem : entry));
          setStatus(`${card.card_faces?.[faceChangeRequest.faceIndex]?.name ?? card.name} valittu.`);
        } catch (error) {
          console.error('Toivelistan kortin facen tallennus epäonnistui:', error);
          setStatus('Kortin face-valintaa ei voitu tallentaa toivelistalle.');
        }
      }
    }
    setFaceChangeRequest(null);
    setOpenDeckCardMenuId(null);
    setOpenCardActionMenuKey(null);
  };

  const openCardInformation = (card: MtgCard) => {
    setCardRulings([]);
    setCardRulingsLoading(true);
    setCardRulingsError(null);
    setCardInfoEntry({ cardId: card.id, card, count: 1, addedAt: Date.now(), isSideboard: false });
    setOpenCardActionMenuKey(null);
  };

  const renderCardActionMenu = (
    card: MtgCard,
    ownerKey: string,
    source: 'search' | 'collection' | 'wishlist',
  ) => {
    const isOpen = openCardActionMenuKey === ownerKey;
    const deckMenuOpen = openCardActionDeckMenuKey === ownerKey;
    const selectedFaceIndex = card.selected_face_index ?? 0;
    return (
      <div data-card-menu className="relative shrink-0">
        <button
          type="button"
          onClick={() => {
            setOpenCardActionMenuKey((current) => current === ownerKey ? null : ownerKey);
            setOpenCardActionDeckMenuKey(null);
          }}
          aria-label={`Kortin toiminnot: ${card.name}`}
          aria-expanded={isOpen}
          className="rounded-md border border-slate-700 bg-slate-900 p-2 text-slate-300 hover:border-violet-500 hover:text-white"
        >
          <MoreVertical size={16} />
        </button>
        {isOpen && (
          <div className="absolute bottom-full right-0 z-40 mb-1 min-w-52 rounded-lg border border-slate-700 bg-slate-900 p-1 shadow-xl">
            {source === 'collection' && (
              <>
                <button type="button" onClick={() => { setOpenCardActionMenuKey(null); void updateCollectionCard(card, 1); }} className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm text-slate-200 hover:bg-slate-800">
                  <Plus size={14} /> Lisää kokoelmaan (+1)
                </button>
                <button type="button" onClick={() => { setOpenCardActionMenuKey(null); void updateCollectionCard(card, -1); }} className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm text-slate-200 hover:bg-slate-800">
                  <Minus size={14} /> Poista kokoelmasta (-1)
                </button>
              </>
            )}
            {(source === 'search' || source === 'wishlist') && (
              <button type="button" onClick={() => { setOpenCardActionMenuKey(null); void updateCollectionCard(card, 1); }} className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm text-slate-200 hover:bg-slate-800">
                <Library size={14} /> Lisää kokoelmaan (+1)
              </button>
            )}
            <button
              type="button"
              onClick={() => setOpenCardActionDeckMenuKey((current) => current === ownerKey ? null : ownerKey)}
              className="flex w-full items-center justify-between gap-2 rounded-md px-3 py-2 text-left text-sm text-slate-200 hover:bg-slate-800"
            >
              <span className="inline-flex items-center gap-2"><FolderPlus size={14} /> Lisää pakkaan</span>
              <ChevronRight size={14} />
            </button>
            {deckMenuOpen && (
              <div className="ml-3 border-l border-slate-700 pl-2">
                {decks.length === 0 ? (
                  <p className="px-3 py-2 text-xs text-slate-400">Luo ensin pakka.</p>
                ) : decks.map((deck) => (
                  <button
                    key={deck.id}
                    type="button"
                    onClick={() => {
                      setOpenCardActionMenuKey(null);
                      setOpenCardActionDeckMenuKey(null);
                      void addCardToDeck(card, 1, deck.id);
                    }}
                    className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm text-slate-200 hover:bg-slate-800"
                  >
                    <Layers size={14} /> {deck.name} (+1)
                  </button>
                ))}
              </div>
            )}
            <button type="button" onClick={() => { setOpenCardActionMenuKey(null); void toggleWishlistCard(card); }} className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm text-slate-200 hover:bg-slate-800">
              <Heart size={14} className={wishlistCardIds.has(card.id) ? 'fill-rose-400 text-rose-400' : ''} />
              {wishlistCardIds.has(card.id) ? 'Poista toivelistalta' : 'Lisää toivelistalle'}
            </button>
            {card.card_faces && card.card_faces.length > 1 && (
              <button
                type="button"
                onClick={() => {
                  setFaceChangeRequest({
                    source,
                    card,
                    faceIndex: selectedFaceIndex,
                    confirm: false,
                  });
                  setOpenCardActionMenuKey(null);
                }}
                className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm text-slate-200 hover:bg-slate-800"
              >
                <RotateCw size={14} /> Vaihda face
              </button>
            )}
            <button type="button" onClick={() => openCardInformation(card)} className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm text-slate-200 hover:bg-slate-800">
              <Info size={14} /> Näytä tiedot
            </button>
            <button type="button" onClick={() => { setOpenCardActionMenuKey(null); openPrintings(card); }} className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm text-slate-200 hover:bg-slate-800">
              <Layers size={14} /> Versiot
            </button>
          </div>
        )}
      </div>
    );
  };

  const renderDeckCardMenu = (entry: DeckCard) => (
    <div data-card-menu className="relative shrink-0">
      <button
        type="button"
        onClick={() => setOpenDeckCardMenuId((current) => current === entry.cardId ? null : entry.cardId)}
        aria-label={`Kortin toiminnot: ${entry.card.name}`}
        aria-expanded={openDeckCardMenuId === entry.cardId}
        className="rounded-md border border-slate-700 bg-slate-900 p-2 text-slate-300 hover:border-violet-500 hover:text-white"
      >
        <MoreVertical size={16} />
      </button>
      {openDeckCardMenuId === entry.cardId && (
        <div className="absolute bottom-full right-0 z-40 mb-1 min-w-48 rounded-lg border border-slate-700 bg-slate-900 p-1 shadow-xl">
          <button
            type="button"
            onClick={() => {
              setOpenDeckCardMenuId(null);
              void addCardToDeck(entry.card, 1, selectedDeckId, entry.cardId);
            }}
            className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm text-slate-200 hover:bg-slate-800"
          >
            <Plus size={14} />
            Lisää (+1)
          </button>
          <button
            type="button"
            onClick={() => {
              setOpenDeckCardMenuId(null);
              void addCardToDeck(entry.card, -1, selectedDeckId, entry.cardId);
            }}
            className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm text-slate-200 hover:bg-slate-800"
          >
            <Minus size={14} />
            Poista (-1)
          </button>
          <button
            type="button"
            onClick={() => void moveDeckCardToSideboard(entry, !entry.isSideboard)}
            className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm text-slate-200 hover:bg-slate-800"
          >
            <Shield size={14} />
            {entry.isSideboard ? 'Siirrä pakan kortteihin' : 'Siirrä sideboardiin'}
          </button>
          <button
            type="button"
            onClick={() => {
              setCardMoveRequest({ deckId: selectedDeckId ?? '', entry });
              setOpenDeckCardMenuId(null);
            }}
            disabled={decks.length < 2}
            className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm text-slate-200 hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <ArrowRightLeft size={14} />
            Siirrä toiseen pakkaan
          </button>
          {entry.card.card_faces && entry.card.card_faces.length > 1 && (
            <button
              type="button"
              onClick={() => {
                setFaceChangeRequest({
                  source: 'deck',
                  deckId: selectedDeckId ?? '',
                  cardId: entry.cardId,
                  card: entry.card,
                  faceIndex: entry.card.selected_face_index ?? 0,
                  confirm: false,
                });
                setOpenDeckCardMenuId(null);
              }}
              className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm text-slate-200 hover:bg-slate-800"
            >
              <RotateCw size={14} />
              Vaihda face
            </button>
          )}
          <button
            type="button"
            onClick={() => {
              setCardRulings([]);
              setCardRulingsLoading(true);
              setCardRulingsError(null);
              setCardInfoEntry(entry);
              setOpenDeckCardMenuId(null);
            }}
            className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm text-slate-200 hover:bg-slate-800"
          >
            <Info size={14} />
            Näytä kortin tiedot
          </button>
        </div>
      )}
    </div>
  );

  const renderDeckEntry = (entry: DeckCard) => {
    const imageUrl = getCardImageUrl(entry.card, cardView === 'grid' ? 'normal' : 'small');
    const stats = getCardStats(entry.card);
    const typeLine = entry.card.card_faces?.[entry.card.selected_face_index ?? 0]?.type_line ?? entry.card.type_line;
    return (
      <div
        key={entry.cardId}
        className={cardView === 'grid'
          ? 'rounded-xl border border-slate-800 bg-slate-950/80 p-2'
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
            <div className="mt-2 flex items-center justify-between">
              <div>
                <span className="text-sm font-semibold text-white">{entry.count} kpl</span>
                {formatCardPrice(entry.card) && (
                  <span className="ml-1.5 text-[11px] font-medium text-emerald-400">· {formatCardPrice(entry.card)}</span>
                )}
              </div>
              {renderDeckCardMenu(entry)}
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
                {typeLine} · {entry.card.set.toUpperCase()} #{entry.card.collector_number}
              </div>
            </button>
            <div className="text-right">
              <div className="min-w-10 text-sm font-semibold text-white">{entry.count} kpl</div>
              {formatCardPrice(entry.card) && (
                <div className="text-[11px] font-medium text-emerald-400">{formatCardPrice(entry.card)}</div>
              )}
            </div>
            {renderDeckCardMenu(entry)}
          </>
        )}
      </div>
    );
  };

  return (
    <div className="min-h-screen bg-[#0b0c10] text-slate-100">
      <header className="border-b border-slate-800 bg-[#0f1117] sticky top-0 z-20 backdrop-blur-sm">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3 sm:px-6">
          <div>
            <p className="text-[10px] uppercase tracking-[0.25em] text-violet-400">v{config.version}</p>
            <h1 className="text-xl font-semibold text-violet-400">{config.name}</h1>
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
                      {decks.length} pakkaa{selectedDeck ? ` · ${deckTotal + sideboardTotal} korttia` : ''}
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
                  <div className="mb-3 flex flex-wrap items-center gap-2">
                    <h2 className="text-sm font-semibold uppercase tracking-[0.2em] text-slate-400">Pakat</h2>
                    <div className="ml-auto flex flex-wrap items-center gap-2">
                      <label className="sr-only" htmlFor="deck-sort">Järjestä pakat</label>
                      <select
                        id="deck-sort"
                        value={deckSortKey}
                        onChange={(event) => setDeckSortKey(event.target.value === 'createdAt' ? 'createdAt' : 'name')}
                        aria-label="Järjestä pakat"
                        className="max-w-36 rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-1.5 text-xs text-slate-200 focus:border-violet-500 focus:outline-none"
                      >
                        <option value="name">Nimi</option>
                        <option value="createdAt">Lisäyspäivä</option>
                      </select>
                      <button
                        type="button"
                        onClick={() => setDeckSortDirection((current) => current === 'asc' ? 'desc' : 'asc')}
                        aria-label={deckSortDirection === 'asc' ? 'Nouseva järjestys' : 'Laskeva järjestys'}
                        title={deckSortDirection === 'asc' ? 'Nouseva järjestys' : 'Laskeva järjestys'}
                        className="rounded-lg border border-slate-700 bg-slate-950/60 p-1.5 text-slate-300 hover:border-violet-500 hover:text-white"
                      >
                        <ArrowUpDown size={15} className={deckSortDirection === 'desc' ? 'rotate-180' : ''} />
                      </button>
                      <button
                        type="button"
                        onClick={() => setShowInactiveDecks((current) => !current)}
                        aria-pressed={showInactiveDecks}
                        className={`rounded-lg border px-2.5 py-1.5 text-xs font-medium ${
                          showInactiveDecks
                            ? 'border-violet-500/50 bg-violet-500/10 text-violet-200'
                            : 'border-slate-700 bg-slate-950/60 text-slate-300 hover:text-white'
                        }`}
                      >
                        {showInactiveDecks ? 'Piilota ei-aktiiviset' : 'Näytä ei-aktiiviset'}
                      </button>
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

                  <div className="space-y-2">
                    {decks.length === 0 && <p className="text-sm text-slate-400">Ei pakkoja vielä.</p>}
                    {decks.length > 0 && visibleDecks.length === 0 && <p className="text-sm text-slate-400">Kaikki pakat ovat ei-aktiivisia. Näytä ne yllä olevalla painikkeella.</p>}
                    {visibleDecks.map((deck) => (
                  <div
                    key={deck.id}
                    className={`flex items-center justify-between gap-3 rounded-xl border px-3 py-2 text-left transition ${
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
                      <div className="min-w-0">
                        <div className="truncate font-medium text-white">{deck.name}</div>
                        <div className="mt-0.5 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-slate-400">
                          <span>{deck.format || 'Pakka'}</span>
                          <span>Lisätty {new Date(deck.createdAt).toLocaleDateString('fi-FI')}</span>
                        </div>
                      </div>
                    </button>
                    <div data-deck-menu className="relative ml-2 flex shrink-0 items-center gap-1">
                      <span className="whitespace-nowrap text-xs text-slate-400">
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
                        <div className="absolute right-0 top-full z-30 mt-1 min-w-48 rounded-lg border border-slate-700 bg-slate-900 p-1 shadow-xl">
                          <button
                            type="button"
                            onClick={() => void toggleDeckActive(deck)}
                            className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm text-slate-200 hover:bg-slate-800"
                          >
                            <Shield size={14} />
                            {deck.active === false ? 'Aseta aktiiviseksi' : 'Aseta ei-aktiiviseksi'}
                          </button>
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
                            onClick={() => {
                              setOpenDeckMenuId(null);
                              void refreshDeckPrices(deck);
                            }}
                            className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm text-slate-200 hover:bg-slate-800"
                          >
                            <RefreshCw size={14} />
                            Päivitä pakan hinnat
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
                    <div className="flex flex-wrap items-center justify-end gap-2">
                      <div className="rounded-full border border-violet-500/50 bg-violet-500/10 px-3 py-1 text-sm text-violet-200">
                        {deckTotal} korttia
                      </div>
                      <button
                        type="button"
                        onClick={() => setSideboardOpen((open) => !open)}
                        aria-expanded={sideboardOpen}
                        aria-controls="deck-sideboard"
                        className={`inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-sm font-medium ${
                          sideboardOpen
                            ? 'border-violet-500 bg-violet-500/15 text-violet-100'
                            : 'border-slate-700 bg-slate-900 text-slate-300 hover:border-violet-500'
                        }`}
                      >
                        <Shield size={16} />
                        Sideboard ({sideboardTotal})
                      </button>
                      {deckUndoSnapshot && deckUndoSnapshot.deckId === selectedDeck.id && (
                        <button
                          type="button"
                          onClick={() => void undoLastDeckChange()}
                          title={`Kumoa: ${deckUndoSnapshot.description}`}
                          className="inline-flex items-center gap-1.5 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm font-medium text-amber-200 hover:bg-amber-500/20"
                        >
                          <Undo2 size={16} />
                          Kumoa muutos
                        </button>
                      )}
                      <CardViewToggle view={cardView} onChange={setCardView} />
                    </div>
                  </div>

                  <ManaCurve
                    cards={selectedDeck.cards}
                    commanderCardId={selectedDeck.commanderCardId}
                    isCommanderDeck={Boolean(selectedDeck.format?.toLowerCase().includes('commander'))}
                    symbols={symbolUris}
                    onPlaytestClick={() => setPlaytestDeck(selectedDeck)}
                    onArenaExportClick={() => void handleCopyArenaExport(selectedDeck)}
                    onRefreshPricesClick={() => void refreshDeckPrices(selectedDeck)}
                    isRefreshingPrices={refreshingDeckPrices}
                  />

                  <CardFilterControls
                    filters={deckFilters}
                    onChange={setDeckFilters}
                    searchValue={deckSearch}
                    onSearchChange={setDeckSearch}
                    searchLabel="Hae valitun pakan korteista"
                    sortKey={deckCardSortKey}
                    onSortKeyChange={setDeckCardSortKey}
                    sortDirection={deckCardSortDirection}
                    onSortDirectionChange={setDeckCardSortDirection}
                  />
                  <p className="mb-3 text-xs text-slate-400">
                    Näytetään {filteredDeckCards.length + (commanderEntry && !filteredDeckCards.some((entry) => entry.cardId === commanderEntry.cardId) ? 1 : 0)} / {selectedDeck.cards.filter((entry) => !entry.isSideboard).length} eri korttia
                  </p>
                  <div className={cardView === 'grid' ? 'grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4' : 'space-y-2'}>
                    {deckTotal === 0 && <p className="text-slate-400">Pakan korttiosio on tyhjä. Hae kortteja ja lisää ne pakkaan.</p>}
                    {deckTotal > 0 && filteredDeckCards.length === 0 && !commanderEntry && (
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
                      return renderDeckEntry(item.entry);
                    })}
                  </div>

                  {sideboardOpen && (
                    <div id="deck-sideboard" className="mt-6 border-t border-slate-800 pt-4">
                      <div className="mb-3 flex items-center justify-between">
                        <h3 className="text-sm font-semibold uppercase tracking-wider text-violet-200">
                          Sideboard ({sideboardTotal})
                        </h3>
                      </div>
                      {filteredSideboardCards.length === 0 ? (
                        <p className="text-sm text-slate-400">
                          {sideboardTotal === 0
                            ? 'Sideboardissa ei ole vielä kortteja.'
                            : 'Haulla tai suodattimilla ei löytynyt sideboard-kortteja.'}
                        </p>
                      ) : (
                        <div className={cardView === 'grid' ? 'grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4' : 'space-y-2'}>
                          {sideboardDisplayItems.map((item) => item.kind === 'section'
                            ? (
                              <h4
                                key={item.key}
                                className={`border-b border-slate-700 pb-2 text-sm font-semibold uppercase tracking-wider text-slate-400 ${cardView === 'grid' ? 'col-span-full pt-2' : 'pt-4 first:pt-0'}`}
                              >
                                {item.title}
                              </h4>
                            )
                            : renderDeckEntry(item.entry))}
                        </div>
                      )}
                    </div>
                  )}
                </>
              ) : (
                <p className="text-slate-400">Valitse pakka.</p>
              )}
            </section>
          </div>
        )}

        {tab === 'search' && (
          <section className="rounded-2xl border border-slate-800 bg-[#10141d] p-4">
            <div className="relative mb-4">
              <div className="flex items-center gap-3 rounded-xl border border-slate-700 bg-slate-950/80 px-3 py-3 focus-within:border-violet-500">
                <Search size={18} className="text-slate-400" />
                <input
                  ref={searchInputRef}
                  value={searchTerm}
                  onChange={(event) => {
                    setSearchTerm(event.target.value);
                    setShowSearchSuggestions(true);
                  }}
                  onFocus={() => setShowSearchSuggestions(true)}
                  onBlur={() => {
                    // Delay so clicking a suggestion still fires
                    setTimeout(() => setShowSearchSuggestions(false), 200);
                  }}
                  placeholder="Hae korttia, esim. Lightning Bolt..."
                  className="w-full min-w-0 bg-transparent text-sm text-white placeholder:text-slate-500 focus:outline-none"
                />
                {searchTerm && (
                  <button
                    type="button"
                    onClick={() => {
                      setSearchTerm('');
                      setShowSearchSuggestions(false);
                    }}
                    aria-label="Tyhjennä korttihaku"
                    className="shrink-0 rounded-full p-1 text-slate-400 hover:bg-slate-800 hover:text-white"
                  >
                    <X size={18} />
                  </button>
                )}
              </div>
              {showSearchSuggestions && searchSuggestions.length > 0 && (
                <ul className="absolute left-0 right-0 top-full z-40 mt-1 max-h-60 overflow-y-auto rounded-xl border border-slate-700 bg-slate-900/95 py-1 shadow-2xl backdrop-blur-md">
                  {searchSuggestions.map((suggestion) => (
                    <li key={suggestion}>
                      <button
                        type="button"
                        onMouseDown={(e) => {
                          e.preventDefault();
                          setSearchTerm(suggestion);
                          setShowSearchSuggestions(false);
                        }}
                        className="w-full px-4 py-2 text-left text-sm text-slate-200 hover:bg-violet-500/20 hover:text-white"
                      >
                        {suggestion}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <CardFilterControls
              filters={searchFilters}
              onChange={setSearchFilters}
              sortKey={searchSortKey}
              onSortKeyChange={setSearchSortKey}
              sortDirection={searchSortDirection}
              onSortDirectionChange={setSearchSortDirection}
            />
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
                        <div className="text-xs text-slate-400">
                          {card.set.toUpperCase()} · #{card.collector_number} · {card.rarity}
                          {formatCardPrice(card) && (
                            <span className="ml-1.5 font-medium text-emerald-400">· {formatCardPrice(card)}</span>
                          )}
                        </div>
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
                    <div className="mt-2 flex min-h-10 items-center justify-between gap-2">
                      <div className="flex flex-wrap items-center gap-1.5">
                        {collectionCardIds.has(card.id) && (
                          <span className="inline-flex items-center gap-1 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-1 text-[10px] font-medium text-emerald-200">
                            <Library size={11} /> Kokoelmassa
                          </span>
                        )}
                        {wishlistCardIds.has(card.id) && (
                          <span className="inline-flex items-center gap-1 rounded-full border border-rose-500/30 bg-rose-500/10 px-2 py-1 text-[10px] font-medium text-rose-200">
                            <Heart size={11} className="fill-rose-300" /> Toivelistalla
                          </span>
                        )}
                      </div>
                      {renderCardActionMenu(cardWithSelectedFace, `search:${card.id}`, 'search')}
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
                {collectionTotalPriceEur > 0 && (
                  <span className="rounded-full border border-emerald-500/30 bg-emerald-500/10 px-3 py-1 text-sm text-emerald-300">
                    ~{collectionTotalPriceEur.toFixed(2)} €
                  </span>
                )}
                <button
                  type="button"
                  onClick={() => void refreshAllPrices()}
                  disabled={refreshingAllPrices}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-3 py-1.5 text-xs font-medium text-emerald-200 hover:bg-emerald-500/20 disabled:cursor-not-allowed disabled:opacity-40"
                  title="Päivittää kokoelman ja kaikkien pakkojen korttien hinnat Scryfallista"
                >
                  <RefreshCw size={14} className={refreshingAllPrices ? 'animate-spin' : ''} />
                  {refreshingAllPrices
                    ? refreshingAllPricesProgress
                      ? `Päivitetään (${refreshingAllPricesProgress.current}/${refreshingAllPricesProgress.total})…`
                      : 'Päivitetään hintoja…'
                    : 'Päivitä kaikki hinnat'}
                </button>
                <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-900 px-3 py-1.5 text-xs font-medium text-slate-200 hover:border-violet-500 hover:bg-slate-800">
                  <Upload size={14} />
                  Tuo kokoelma (JSON / CSV)
                  <input type="file" accept=".json,.csv,.txt" className="hidden" onChange={handleCollectionFileSelect} />
                </label>
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
                        <div className="mt-2 flex items-center justify-between">
                          <div>
                            <span className="text-sm font-semibold text-white">{entry.count} kpl</span>
                            {formatCardPrice(entry.card) && (
                              <span className="ml-1.5 text-[11px] font-medium text-emerald-400">· {formatCardPrice(entry.card)}</span>
                            )}
                          </div>
                          {renderCardActionMenu(entry.card, `collection:${entry.id}`, 'collection')}
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
                          <div className="text-right">
                            <div className="min-w-10 text-sm font-semibold text-white">{entry.count} kpl</div>
                            {formatCardPrice(entry.card) && (
                              <div className="text-[11px] font-medium text-emerald-400">{formatCardPrice(entry.card)}</div>
                            )}
                          </div>
                          {renderCardActionMenu(entry.card, `collection:${entry.id}`, 'collection')}
                        </div>
                      </>
                    )}
                  </div>
                );
              })}
            </div>
          </section>
        )}

        {tab === 'wishlist' && (
          <section className="rounded-2xl border border-slate-800 bg-[#10141d] p-4">
            <div className="mb-4 flex items-center justify-between gap-3 border-b border-slate-800 pb-4">
              <div>
                <h2 className="text-xl font-semibold text-white">Toivelista</h2>
                <p className="text-sm text-slate-400">Kortit tallentuvat tälle laitteelle.</p>
              </div>
              <div className="flex items-center gap-3">
                <span className="rounded-full border border-rose-500/40 bg-rose-500/10 px-3 py-1 text-sm text-rose-200">
                  {wishlist.length} korttia
                </span>
                {wishlistTotalPriceEur > 0 && (
                  <span className="rounded-full border border-emerald-500/30 bg-emerald-500/10 px-3 py-1 text-sm text-emerald-300">
                    ~{wishlistTotalPriceEur.toFixed(2)} €
                  </span>
                )}
                <CardViewToggle view={cardView} onChange={setCardView} />
              </div>
            </div>
            <CardFilterControls
              filters={wishlistFilters}
              onChange={setWishlistFilters}
              searchValue={wishlistSearch}
              onSearchChange={setWishlistSearch}
              searchLabel="Hae toivelistalta"
              sortKey={collectionSortKey}
              onSortKeyChange={setCollectionSortKey}
              sortDirection={collectionSortDirection}
              onSortDirectionChange={setCollectionSortDirection}
            />
            <div className={cardView === 'grid' ? 'grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-5' : 'space-y-2'}>
              {sortedWishlist.length === 0 && (
                <p className={`rounded-xl border border-dashed border-slate-700 p-6 text-center text-slate-400 ${cardView === 'grid' ? 'col-span-full' : ''}`}>
                  Toivelista on tyhjä. Lisää kortteja sinne korttihaun kolmen pisteen valikosta.
                </p>
              )}
              {sortedWishlist.map((entry) => {
                const imageUrl = getCardImageUrl(entry.card, cardView === 'grid' ? 'normal' : 'small');
                return (
                  <div
                    key={entry.id}
                    className={cardView === 'grid'
                      ? 'overflow-hidden rounded-xl border border-slate-800 bg-slate-950/80 p-2'
                      : 'flex items-center gap-3 rounded-xl border border-slate-800 bg-slate-950/80 p-3'}
                  >
                    {cardView === 'grid' ? (
                      <>
                        <button type="button" onClick={() => openCardPreview(entry.card)} aria-label={`Näytä ${entry.card.name} isompana`} className="block w-full overflow-hidden rounded-lg focus:outline-none focus:ring-2 focus:ring-violet-400">
                          <img src={imageUrl ?? 'https://placehold.co/488x680/111827/9ca3af?text=MTG'} alt={entry.card.name} loading="lazy" className="aspect-[5/7] w-full object-cover" />
                        </button>
                        <div className="mt-2 min-h-12">
                          <div className="truncate text-sm font-medium text-white" title={entry.card.name}>{entry.card.name}</div>
                          <div className="mt-1"><CardManaCost card={entry.card} symbols={symbolUris} /></div>
                        </div>
                        <div className="mt-2 flex items-center justify-between">
                          <div>
                            <span className="inline-flex items-center gap-1 text-xs text-rose-200"><Heart size={13} className="fill-rose-300" /> Toivelistalla</span>
                            {formatCardPrice(entry.card) && (
                              <span className="ml-1.5 text-[11px] font-medium text-emerald-400">· {formatCardPrice(entry.card)}</span>
                            )}
                          </div>
                          {renderCardActionMenu(entry.card, `wishlist:${entry.id}`, 'wishlist')}
                        </div>
                      </>
                    ) : (
                      <>
                        <button type="button" onClick={() => openCardPreview(entry.card)} aria-label={`Näytä ${entry.card.name} isompana`} className="min-w-0 flex-1 rounded text-left focus:outline-none focus:ring-2 focus:ring-violet-400">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="font-medium text-white">{entry.card.name}</span>
                            <CardManaCost card={entry.card} symbols={symbolUris} />
                          </div>
                          <div className="mt-1 text-xs text-slate-400">{entry.card.type_line} · {entry.card.set.toUpperCase()} #{entry.card.collector_number}</div>
                        </button>
                        <div className="flex flex-wrap items-center justify-end gap-2">
                          {formatCardPrice(entry.card) && (
                            <span className="text-[11px] font-medium text-emerald-400">{formatCardPrice(entry.card)}</span>
                          )}
                          <span className="inline-flex items-center gap-1 text-xs text-rose-200"><Heart size={13} className="fill-rose-300" /></span>
                          {renderCardActionMenu(entry.card, `wishlist:${entry.id}`, 'wishlist')}
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
                placeholder={'4 Lightning Bolt (M25) 141\n2 Counterspell\nSideboard\n2 Pyroblast\n\n// Voit liittää tähän myös JSON-muotoisen pakan tai kokoelman'}
                className="min-h-[220px] w-full rounded-xl border border-slate-700 bg-slate-950/80 p-3 text-sm text-slate-100 placeholder:text-slate-500 focus:border-violet-500 focus:outline-none"
              />
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => void importAsNewDeck(importEntries)}
                  disabled={importEntries.length === 0}
                  className="inline-flex items-center gap-2 rounded-lg bg-violet-600 px-3.5 py-2 text-sm font-medium text-white shadow-md transition hover:bg-violet-500 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <FolderPlus size={16} />
                  Tuo uutena pakkana
                </button>
                <button
                  type="button"
                  onClick={() => void applyImportedEntries(importEntries)}
                  disabled={importEntries.length === 0}
                  className="inline-flex items-center gap-2 rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm font-medium text-slate-200 hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <Layers size={16} />
                  Lisää valittuun pakkaan
                </button>
                <button
                  type="button"
                  onClick={async () => {
                    const identifiers = importEntries.map((entry) => {
                      if (entry.set && entry.collector_number) {
                        return { set: entry.set, collector_number: entry.collector_number };
                      }
                      return { name: entry.name };
                    });
                    const result = await fetchCardsBatch(identifiers);
                    const cardsByName = new Map(result.found.map((card) => [card.name.toLowerCase(), card]));
                    const cardsBySetNumber = new Map(result.found.map((card) => [`${card.set.toLowerCase()}:${card.collector_number.toLowerCase()}`, card]));
                    for (const entry of importEntries) {
                      const card = (entry.set && entry.collector_number && cardsBySetNumber.get(`${entry.set.toLowerCase()}:${entry.collector_number.toLowerCase()}`))
                        || cardsByName.get(entry.name.toLowerCase());
                      if (card) await updateCollectionCard(card, entry.count);
                    }
                    const msg = `Lisättiin ${importEntries.length} korttia kokoelmaan.`;
                    setStatus(msg);
                    setToast(msg);
                  }}
                  className="inline-flex items-center gap-2 rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm font-medium text-slate-200 hover:bg-slate-800"
                >
                  <Library size={16} />
                  Lisää kokoelmaan
                </button>
                <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-violet-500/40 bg-violet-500/10 px-3 py-2 text-sm text-violet-200 hover:bg-violet-500/20">
                  <Upload size={16} />
                  Tuo kokoelmatiedosto (JSON / CSV)
                  <input type="file" accept=".json,.csv,.txt" className="hidden" onChange={handleCollectionFileSelect} />
                </label>
                <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-200 hover:bg-slate-800">
                  <Upload size={16} />
                  Tuo pakka (JSON / CSV)
                  <input type="file" accept=".json,.csv,.txt" className="hidden" onChange={handleFileImport} />
                </label>
                <label className="inline-flex items-center gap-2 rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-200">
                  <Download size={16} />
                  Vientimuoto
                  <select
                    value={exportFormat}
                    onChange={(event) => setExportFormat(event.target.value === 'csv' ? 'csv' : 'json')}
                    aria-label="Valitse vientimuoto"
                    className="rounded border border-slate-700 bg-slate-950 px-2 py-1 text-xs text-white focus:border-violet-500 focus:outline-none"
                  >
                    <option value="json">JSON</option>
                    <option value="csv">CSV</option>
                  </select>
                </label>
                <div data-export-menu className="relative">
                  <button
                    type="button"
                    onClick={() => setExportDeckMenuOpen((current) => !current)}
                    aria-expanded={exportDeckMenuOpen}
                    className="inline-flex items-center gap-2 rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-200 hover:bg-slate-800"
                  >
                    <Layers size={16} />
                    Vie pakka
                    <ChevronDown size={14} />
                  </button>
                  {exportDeckMenuOpen && (
                    <div className="absolute left-0 top-full z-30 mt-1 max-h-64 min-w-56 overflow-y-auto rounded-lg border border-slate-700 bg-slate-900 p-1 shadow-xl">
                      {decks.length === 0
                        ? <p className="px-3 py-2 text-sm text-slate-400">Ei pakkoja vietäväksi.</p>
                        : decks.map((deck) => (
                          <button
                            key={deck.id}
                            type="button"
                            onClick={() => handleExport('deck', deck)}
                            className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm text-slate-200 hover:bg-slate-800"
                          >
                            <Layers size={14} /> {deck.name}
                          </button>
                        ))}
                    </div>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => handleExport('collection')}
                  className="inline-flex items-center gap-2 rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-200 hover:bg-slate-800"
                >
                  <Library size={16} />
                  Vie kokoelma
                </button>
                <button
                  type="button"
                  onClick={() => handleExport('all')}
                  className="inline-flex items-center gap-2 rounded-lg border border-violet-500/40 bg-violet-500/10 px-3 py-2 text-sm text-violet-200 hover:bg-violet-500/20"
                >
                  <Download size={16} />
                  Vie kaikki tiedot
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
        <div className="mx-auto grid max-w-xl grid-cols-5">
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
                className={`relative flex min-h-16 flex-col items-center justify-center gap-1 px-1 py-2 text-[10px] font-medium transition ${
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
            {deckNameDialog.mode === 'create' && (
              <>
                <label htmlFor="deck-format-input" className="mt-4 block text-sm text-slate-300">
                  Pakan tyyppi / formaatti
                </label>
                <input
                  id="deck-format-input"
                  value={deckFormatInput}
                  onChange={(event) => setDeckFormatInput(event.target.value)}
                  maxLength={40}
                  placeholder="Esim. Commander, Modern, Casual"
                  className="mt-2 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2.5 text-white placeholder:text-slate-500 focus:border-violet-500 focus:outline-none"
                />
              </>
            )}
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

      {cardMoveRequest && (
        <div
          className="fixed inset-0 z-[65] flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm"
          role="presentation"
          onClick={() => setCardMoveRequest(null)}
        >
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="move-card-title"
            className="w-full max-w-md rounded-2xl border border-slate-700 bg-[#10141d] p-5 shadow-2xl"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="mb-4 flex items-start justify-between gap-4">
              <div>
                <h2 id="move-card-title" className="text-lg font-semibold text-white">Siirrä toiseen pakkaan</h2>
                <p className="mt-1 text-sm text-slate-400">
                  Siirretään {cardMoveRequest.entry.count} kpl korttia {cardMoveRequest.entry.card.name}.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setCardMoveRequest(null)}
                aria-label="Sulje pakan valinta"
                className="rounded-lg bg-slate-800 p-2 text-slate-200 hover:bg-slate-700"
              >
                <X size={18} />
              </button>
            </div>
            <div className="max-h-[55dvh] space-y-2 overflow-y-auto">
              {decks.filter((deck) => deck.id !== cardMoveRequest.deckId).map((deck) => (
                <button
                  key={deck.id}
                  type="button"
                  onClick={() => void moveDeckCardToAnotherDeck(deck.id)}
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

      {faceChangeRequest && (
        <div
          className="fixed inset-0 z-[65] flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm"
          role="presentation"
          onClick={() => setFaceChangeRequest(null)}
        >
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="face-change-title"
            className="w-full max-w-lg rounded-2xl border border-slate-700 bg-[#10141d] p-5 shadow-2xl"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="mb-4 flex items-start justify-between gap-4">
              <div>
                <h2 id="face-change-title" className="text-lg font-semibold text-white">Vaihda face</h2>
                <p className="mt-1 text-sm text-slate-400">{faceChangeRequest.card.name}</p>
              </div>
              <button
                type="button"
                onClick={() => setFaceChangeRequest(null)}
                aria-label="Sulje facen valinta"
                className="rounded-lg bg-slate-800 p-2 text-slate-200 hover:bg-slate-700"
              >
                <X size={18} />
              </button>
            </div>
            <div className="grid grid-cols-2 gap-3">
              {faceChangeRequest.card.card_faces?.map((face, index) => {
                const faceCard = { ...faceChangeRequest.card, selected_face_index: index };
                const isSelected = faceChangeRequest.faceIndex === index;
                return (
                  <button
                    key={`${face.name}-${index}`}
                    type="button"
                    onClick={() => setFaceChangeRequest((current) => current
                      ? { ...current, faceIndex: index, confirm: false }
                      : null)}
                    aria-pressed={isSelected}
                    className={`rounded-xl border p-2 text-left ${
                      isSelected
                        ? 'border-violet-400 bg-violet-500/10 ring-1 ring-violet-400'
                        : 'border-slate-700 bg-slate-900 hover:border-slate-500'
                    }`}
                  >
                    <img
                      src={getCardImageUrl(faceCard, 'normal') ?? 'https://placehold.co/488x680/111827/9ca3af?text=MTG'}
                      alt={face.name}
                      className="mb-2 aspect-[5/7] w-full rounded-lg object-cover"
                    />
                    <span className="block truncate text-sm font-medium text-white">{face.name}</span>
                    {face.type_line && <span className="mt-1 block truncate text-xs text-slate-400">{face.type_line}</span>}
                  </button>
                );
              })}
            </div>
            {faceChangeRequest.source !== 'deck' || !faceChangeRequest.confirm ? (
              <button
                type="button"
                onClick={() => faceChangeRequest.source === 'deck'
                  ? setFaceChangeRequest((current) => current ? { ...current, confirm: true } : null)
                  : void applyFaceChange('replace')}
                className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-lg bg-violet-500 px-4 py-2.5 text-sm font-medium text-white hover:bg-violet-400"
              >
                {faceChangeRequest.source === 'deck' ? <Plus size={16} /> : <RotateCw size={16} />}
                {faceChangeRequest.source === 'deck' ? 'Lisää pakkaan' : 'Valitse face'}
              </button>
            ) : (
              <div className="mt-4 rounded-xl border border-slate-700 bg-slate-950/70 p-3">
                <p className="text-sm font-medium text-white">Korvataanko valittu kortti vai lisätäänkö uutena?</p>
                <p className="mt-1 text-xs text-slate-400">
                  Uutena lisääminen luo oman korttirivin ja lisää yhden kappaleen.
                </p>
                <div className="mt-3 flex flex-wrap justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => setFaceChangeRequest((current) => current ? { ...current, confirm: false } : null)}
                    className="rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-300 hover:bg-slate-800"
                  >
                    Takaisin
                  </button>
                  <button
                    type="button"
                    onClick={() => void applyFaceChange('replace')}
                    className="rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-200 hover:bg-slate-800"
                  >
                    Korvaa valittu
                  </button>
                  <button
                    type="button"
                    onClick={() => void applyFaceChange('add')}
                    className="rounded-lg bg-violet-500 px-3 py-2 text-sm font-medium text-white hover:bg-violet-400"
                  >
                    Lisää uutena
                  </button>
                </div>
              </div>
            )}
          </section>
        </div>
      )}

      {playtestDeck && (
        <SampleHandModal
          deckName={playtestDeck.name}
          cards={playtestDeck.cards}
          onClose={() => setPlaytestDeck(null)}
          onCardClick={(card) => openCardPreview(card)}
        />
      )}

      {cardInfoEntry && (
        <CardInfoModal
          entry={cardInfoEntry}
          cardRulings={cardRulings}
          cardRulingsLoading={cardRulingsLoading}
          cardRulingsError={cardRulingsError}
          onClose={() => setCardInfoEntry(null)}
          renderManaCost={(card) => <CardManaCost card={card} symbols={symbolUris} />}
        />
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
        <PrintingsModal
          card={printingCard}
          printings={printings}
          selectedPrinting={selectedPrinting}
          printingsLoading={printingsLoading}
          printingsError={printingsError}
          printingsHasMore={printingsHasMore}
          onClose={() => setPrintingCard(null)}
          onSelectPrinting={setSelectedPrinting}
          onPreviewPrinting={(printing) => openCardPreview(printing, 'printings')}
          onLoadMore={() => setPrintingsPage((p) => p + 1)}
          onAddToDeck={(printing) => chooseDeckForPrinting(printing)}
          onAddToCollection={(printing) => void updateCollectionCard(printing, 1)}
        />
      )}

      {collectionImportPending && (
        <CollectionImportModal
          fileName={collectionImportPending.fileName}
          entries={collectionImportPending.entries}
          isLoading={collectionImportLoading}
          progress={collectionImportProgress}
          onClose={() => setCollectionImportPending(null)}
          onConfirm={(mode) => void executeCollectionImport(mode)}
        />
      )}
    </div>
  );
}

export default App;
