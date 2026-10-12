import Dexie, { type Table } from 'dexie';
import type { Deck, CollectionCard, MtgCard, ExportData, WishlistCard } from '../types';

export class MtgDatabase extends Dexie {
  decks!: Table<Deck, string>;
  collection!: Table<CollectionCard, string>;
  wishlist!: Table<WishlistCard, string>;
  cardCache!: Table<MtgCard, string>;

  constructor() {
    super('MtgVaultDB');
    this.version(1).stores({
      decks: 'id, name, updatedAt, createdAt',
      collection: 'id, addedAt',
      cardCache: 'id, name, set, collector_number, cached_at'
    });
    this.version(2).stores({
      decks: 'id, name, updatedAt, createdAt',
      collection: 'id, addedAt',
      wishlist: 'id, addedAt',
      cardCache: 'id, name, set, collector_number, cached_at'
    });
  }
}

export const db = new MtgDatabase();

// Helper to export all data to JSON
export async function exportAllData(): Promise<ExportData> {
  const decks = await db.decks.toArray();
  const collection = await db.collection.toArray();
  const wishlist = await db.wishlist.toArray();
  return {
    version: 2,
    exportedAt: Date.now(),
    decks,
    collection,
    wishlist,
  };
}

// Helper to import all data from JSON
export async function importAllData(data: ExportData, mode: 'merge' | 'replace' = 'merge'): Promise<{ decksCount: number; collectionCount: number; wishlistCount: number }> {
  if (!data || !Array.isArray(data.decks)) {
    throw new Error('Virheellinen varmuuskopiotiedosto.');
  }

  return await db.transaction('rw', db.decks, db.collection, db.wishlist, db.cardCache, async () => {
    if (mode === 'replace') {
      await db.decks.clear();
      await db.collection.clear();
      await db.wishlist.clear();
    }

    let decksCount = 0;
    for (const deck of data.decks) {
      await db.decks.put(deck);
      decksCount++;
      // Cache cards embedded in deck
      for (const dc of deck.cards) {
        if (dc.card) {
          await db.cardCache.put({ ...dc.card, cached_at: Date.now() });
        }
      }
    }

    let collectionCount = 0;
    if (Array.isArray(data.collection)) {
      for (const item of data.collection) {
        await db.collection.put(item);
        collectionCount++;
        if (item.card) {
          await db.cardCache.put({ ...item.card, cached_at: Date.now() });
        }
      }
    }

    let wishlistCount = 0;
    if (Array.isArray(data.wishlist)) {
      for (const item of data.wishlist) {
        await db.wishlist.put(item);
        wishlistCount++;
        if (item.card) {
          await db.cardCache.put({ ...item.card, cached_at: Date.now() });
        }
      }
    }

    return { decksCount, collectionCount, wishlistCount };
  });
}
