import { db } from '../db';
import type { MtgCard } from '../types';

const SCRYFALL_API = 'https://api.scryfall.com';

export async function fetchCardSymbolUris(): Promise<Map<string, string>> {
  const response = await fetch(`${SCRYFALL_API}/symbology`);
  if (!response.ok) {
    throw new Error(`Scryfall-symbolien haku epäonnistui: ${response.status} ${response.statusText}`);
  }

  const result: { data?: Array<{ symbol: string; svg_uri: string }> } = await response.json();
  return new Map((result.data ?? []).map(({ symbol, svg_uri }) => [symbol, svg_uri]));
}

// Clean and normalize Scryfall card response into our lightweight MtgCard format
// Notice we NEVER download the image blob, we only store the Scryfall CDN URLs.
export function sanitizeScryfallCard(raw: any): MtgCard {
  return {
    id: raw.id,
    name: raw.name,
    mana_cost: raw.mana_cost,
    cmc: raw.cmc,
    type_line: raw.type_line,
    oracle_text: raw.oracle_text,
    power: raw.power,
    toughness: raw.toughness,
    loyalty: raw.loyalty,
    defense: raw.defense,
    colors: raw.colors,
    color_identity: raw.color_identity,
    keywords: raw.keywords,
    set: raw.set,
    set_name: raw.set_name,
    collector_number: raw.collector_number,
    rarity: raw.rarity,
    lang: raw.lang,
    prints_search_uri: raw.prints_search_uri,
    image_uris: raw.image_uris ? {
      small: raw.image_uris.small,
      normal: raw.image_uris.normal,
      large: raw.image_uris.large,
      art_crop: raw.image_uris.art_crop,
    } : undefined,
    card_faces: raw.card_faces ? raw.card_faces.map((face: any) => ({
      name: face.name,
      mana_cost: face.mana_cost,
      type_line: face.type_line,
      oracle_text: face.oracle_text,
      power: face.power,
      toughness: face.toughness,
      loyalty: face.loyalty,
      defense: face.defense,
      image_uris: face.image_uris ? {
        small: face.image_uris.small,
        normal: face.image_uris.normal,
        large: face.image_uris.large,
        art_crop: face.image_uris.art_crop,
      } : undefined,
    })) : undefined,
    scryfall_uri: raw.scryfall_uri,
    cached_at: Date.now(),
  };
}

export async function searchCardPrintings(
  card: MtgCard,
  page = 1,
): Promise<{ cards: MtgCard[]; hasMore: boolean; totalCards: number }> {
  const url = card.prints_search_uri
    ? new URL(card.prints_search_uri)
    : new URL(`${SCRYFALL_API}/cards/search`);

  if (!card.prints_search_uri) {
    url.searchParams.set('q', `!"${card.name}"`);
    url.searchParams.set('unique', 'prints');
    url.searchParams.set('order', 'released');
    url.searchParams.set('dir', 'desc');
  }
  url.searchParams.set('page', String(page));

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Scryfall-julkaisujen haku epäonnistui: ${response.status} ${response.statusText}`);
  }

  const result = await response.json();
  const cards = (result.data ?? []).map(sanitizeScryfallCard);

  return {
    cards,
    hasMore: result.has_more ?? false,
    totalCards: result.total_cards ?? cards.length,
  };
}

export function getCardImageUrl(card: MtgCard, size: 'small' | 'normal' | 'large' | 'art_crop' = 'normal'): string | undefined {
  const selectedFace = card.card_faces?.[card.selected_face_index ?? 0];
  if (selectedFace?.image_uris?.[size]) {
    return selectedFace.image_uris[size];
  }
  if (card.image_uris?.[size]) {
    return card.image_uris[size];
  }
  if (card.card_faces?.[0]?.image_uris?.[size]) {
    return card.card_faces[0].image_uris[size];
  }
  return undefined;
}

// Search autocomplete for quick suggestion dropdown
export async function autocompleteCardName(query: string): Promise<string[]> {
  if (!query || query.trim().length < 2) return [];
  try {
    const res = await fetch(`${SCRYFALL_API}/cards/autocomplete?q=${encodeURIComponent(query.trim())}`);
    if (!res.ok) return [];
    const json = await res.json();
    return json.data || [];
  } catch (err) {
    console.error('Autocomplete error:', err);
    return [];
  }
}

// Search cards by query with Scryfall syntax
export async function searchCards(query: string, page = 1): Promise<{ cards: MtgCard[]; hasMore: boolean; totalCards: number }> {
  if (!query || !query.trim()) return { cards: [], hasMore: false, totalCards: 0 };

  try {
    const res = await fetch(`${SCRYFALL_API}/cards/search?q=${encodeURIComponent(query.trim())}&page=${page}`);
    if (!res.ok) {
      if (res.status === 404) {
        return { cards: [], hasMore: false, totalCards: 0 };
      }
      throw new Error(`Scryfall virhe: ${res.statusText}`);
    }
    const json = await res.json();
    const cards = (json.data || []).map(sanitizeScryfallCard);

    // Cache cards in IndexedDB
    for (const c of cards) {
      db.cardCache.put(c).catch(() => {});
    }

    return {
      cards,
      hasMore: json.has_more ?? false,
      totalCards: json.total_cards ?? cards.length,
    };
  } catch (err) {
    console.error('Search cards error:', err);
    throw err;
  }
}

// Batch lookup cards using Scryfall /cards/collection endpoint (supports up to 75 identifiers at a time)
export interface CardIdentifier {
  id?: string;
  name?: string;
  set?: string;
  collector_number?: string;
}

export async function fetchCardsBatch(identifiers: CardIdentifier[]): Promise<{ found: MtgCard[]; notFound: CardIdentifier[] }> {
  const chunkSize = 75;
  const found: MtgCard[] = [];
  const notFound: CardIdentifier[] = [];

  for (let i = 0; i < identifiers.length; i += chunkSize) {
    const chunk = identifiers.slice(i, i + chunkSize);
    try {
      const res = await fetch(`${SCRYFALL_API}/cards/collection`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ identifiers: chunk }),
      });

      if (!res.ok) {
        throw new Error(`Scryfall batch error ${res.status}`);
      }

      const json = await res.json();
      if (json.data) {
        const sanitized = json.data.map(sanitizeScryfallCard);
        found.push(...sanitized);
        // Cache found cards
        for (const c of sanitized) {
          db.cardCache.put(c).catch(() => {});
        }
      }
      if (json.not_found) {
        notFound.push(...json.not_found);
      }

      // Small delay between chunks to respect Scryfall guidelines (50-100ms)
      if (i + chunkSize < identifiers.length) {
        await new Promise((r) => setTimeout(r, 100));
      }
    } catch (err) {
      console.error('Batch fetch error for chunk:', err);
      notFound.push(...chunk);
    }
  }

  return { found, notFound };
}
