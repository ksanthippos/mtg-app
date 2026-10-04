export interface MtgCard {
  id: string; // Scryfall ID
  name: string;
  mana_cost?: string;
  cmc?: number;
  type_line: string;
  oracle_text?: string;
  colors?: string[];
  color_identity?: string[];
  set: string;
  set_name?: string;
  collector_number: string;
  rarity: string;
  image_uris?: {
    small?: string;
    normal?: string;
    large?: string;
    art_crop?: string;
  };
  card_faces?: Array<{
    name: string;
    mana_cost?: string;
    type_line?: string;
    oracle_text?: string;
    image_uris?: {
      small?: string;
      normal?: string;
      large?: string;
      art_crop?: string;
    };
  }>;
  scryfall_uri?: string;
  cached_at?: number;
}

export interface DeckCard {
  cardId: string; // references MtgCard.id
  card: MtgCard; // embedded snapshot for instant rendering offline
  count: number;
  isSideboard?: boolean;
}

export interface Deck {
  id: string;
  name: string;
  format?: string;
  description?: string;
  colors?: string[];
  cards: DeckCard[];
  createdAt: number;
  updatedAt: number;
}

export interface CollectionCard {
  id: string; // Scryfall ID
  card: MtgCard;
  count: number;
  addedAt: number;
}

export interface ExportData {
  version: 1;
  exportedAt: number;
  decks: Deck[];
  collection: CollectionCard[];
}
