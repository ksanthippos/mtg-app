export type ParsedDeckEntry = {
  name: string;
  count: number;
  source: string;
  scryfall_id?: string;
  set?: string;
  collector_number?: string;
  isSideboard?: boolean;
  isCommander?: boolean;
};

export function parseDecklistText(rawText: string): ParsedDeckEntry[] {
  if (!rawText || !rawText.trim()) return [];

  const trimmed = rawText.trim();
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    const jsonEntries = parseJsonImport(trimmed);
    if (jsonEntries.length > 0) return jsonEntries;
  }

  const rawLines = rawText.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const parsed: ParsedDeckEntry[] = [];
  let inSideboard = false;
  let inCommander = false;

  for (let line of rawLines) {
    // Check section headers (e.g. "Sideboard", "SB:", "// Sideboard", "Mainboard", "// Main", "// Commander")
    if (/^(\/\/\s*)?(commander|general)\b/i.test(line)) {
      inCommander = true;
      inSideboard = false;
      continue;
    }
    if (/^(\/\/\s*)?(sideboard|sb:|board|side)\b/i.test(line)) {
      inSideboard = true;
      inCommander = false;
      continue;
    }
    if (/^(\/\/\s*)?(mainboard|main deck|deck|main)\b/i.test(line)) {
      inSideboard = false;
      inCommander = false;
      continue;
    }
    // Skip general comment lines
    if (line.startsWith('//')) {
      continue;
    }

    let isSideboard = inSideboard;
    let isCommander = inCommander;
    if (/^sb:\s*/i.test(line)) {
      isSideboard = true;
      line = line.replace(/^sb:\s*/i, '');
    }

    const match = line.match(/^([0-9]+x?)\s+(.+)$/i);
    if (!match) continue;

    const count = Number(match[1].replace(/x/i, ''));
    if (!Number.isFinite(count) || count <= 0) continue;

    let remainder = match[2].trim();
    let set: string | undefined;
    let collectorNumber: string | undefined;

    // Pattern 1: Name (SET) 123 or Name [SET] 123 or Name (SET) #123
    const setNumberMatch = remainder.match(/^(.+?)\s+[([]([A-Za-z0-9]+)[\])]\s+#?([A-Za-z0-9\-★]+)$/);
    if (setNumberMatch) {
      remainder = setNumberMatch[1].trim();
      set = setNumberMatch[2].toLowerCase();
      collectorNumber = setNumberMatch[3];
    } else {
      // Pattern 2: Name (SET) or Name [SET]
      const setMatch = remainder.match(/^(.+?)\s+[([]([A-Za-z0-9]+)[\])]$/);
      if (setMatch) {
        remainder = setMatch[1].trim();
        set = setMatch[2].toLowerCase();
      } else {
        // Pattern 3: Name SET 123 (e.g. Arena export: "4 Lightning Bolt M25 141")
        const arenaMatch = remainder.match(/^(.+?)\s+([A-Za-z0-9]{3,5})\s+([0-9]+)$/);
        if (arenaMatch && !['and', 'the', 'for', 'with', 'into'].includes(arenaMatch[2].toLowerCase())) {
          remainder = arenaMatch[1].trim();
          set = arenaMatch[2].toLowerCase();
          collectorNumber = arenaMatch[3];
        }
      }
    }

    const name = remainder.trim();
    if (name) {
      parsed.push({
        name,
        count,
        source: 'decklist',
        set,
        collector_number: collectorNumber,
        isSideboard,
        isCommander,
      });
      if (inCommander) {
        inCommander = false;
      }
    }
  }

  return parsed;
}

function parseCsvRow(line: string): string[] {
  const cells: string[] = [];
  let cell = '';
  let quoted = false;
  for (let index = 0; index < line.length; index++) {
    const character = line[index];
    if (character === '"' && quoted && line[index + 1] === '"') {
      cell += '"';
      index++;
    } else if (character === '"') {
      quoted = !quoted;
    } else if (character === ',' && !quoted) {
      cells.push(cell.trim());
      cell = '';
    } else {
      cell += character;
    }
  }
  cells.push(cell.trim());
  return cells;
}

/** Parses CSV export from ManaBox, Moxfield, MTGGoldfish, DelverLens, or MTG-apuri */
export function parseCsvImport(rawText: string): ParsedDeckEntry[] {
  if (!rawText || !rawText.trim()) return [];

  const lines = rawText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length === 0) return [];

  const firstRow = parseCsvRow(lines[0]);

  // Dynamic header mapping
  let nameIndex = -1;
  let countIndex = -1;
  let scryfallIdIndex = -1;
  let setIndex = -1;
  let collectorNumberIndex = -1;
  let areaIndex = -1;

  for (let i = 0; i < firstRow.length; i++) {
    const header = firstRow[i].toLowerCase().replace(/[^a-z0-9]/g, '');
    if (['name', 'cardname', 'card', 'kortinnimi'].includes(header) && nameIndex === -1) {
      nameIndex = i;
    } else if (['quantity', 'count', 'qty', 'kpl', 'amount', 'maara'].includes(header) && countIndex === -1) {
      countIndex = i;
    } else if (['scryfallid', 'scryfall', 'id'].includes(header) && scryfallIdIndex === -1) {
      scryfallIdIndex = i;
    } else if (['setcode', 'set', 'edition', 'sarja', 'expansion'].includes(header) && setIndex === -1) {
      setIndex = i;
    } else if (['collectornumber', 'number', 'cardnumber', 'numero'].includes(header) && collectorNumberIndex === -1) {
      collectorNumberIndex = i;
    } else if (['sideboard', 'section', 'area', 'board'].includes(header) && areaIndex === -1) {
      areaIndex = i;
    }
  }

  const hasHeader = nameIndex !== -1 || countIndex !== -1 || scryfallIdIndex !== -1;
  const startRow = hasHeader ? 1 : 0;

  // Fallback heuristic if no matching headers found
  if (!hasHeader) {
    const isFirstNum = Number.isFinite(Number(firstRow[0]?.replace(/x/i, '')));
    if (isFirstNum) {
      countIndex = 0;
      nameIndex = 1;
      setIndex = 2;
      collectorNumberIndex = 4;
      areaIndex = 5;
    } else {
      nameIndex = 0;
      countIndex = 1;
    }
  }

  const parsed: ParsedDeckEntry[] = [];

  for (let r = startRow; r < lines.length; r++) {
    const cells = parseCsvRow(lines[r]);
    if (cells.length < 2) continue;

    const rawName = (nameIndex >= 0 ? cells[nameIndex] : '')?.replace(/^"|"$/g, '').trim();
    const rawCount = (countIndex >= 0 ? cells[countIndex] : '')?.replace(/x/i, '').trim();
    const scryfallId = (scryfallIdIndex >= 0 ? cells[scryfallIdIndex] : '')?.replace(/^"|"$/g, '').trim() || undefined;
    const set = (setIndex >= 0 ? cells[setIndex] : '')?.replace(/^"|"$/g, '').trim().toLowerCase() || undefined;
    const collectorNumber = (collectorNumberIndex >= 0 ? cells[collectorNumberIndex] : '')?.replace(/^"|"$/g, '').trim() || undefined;
    const area = (areaIndex >= 0 ? cells[areaIndex] : '')?.replace(/^"|"$/g, '').toLowerCase().trim();
    const isSideboard = area === 'sideboard' || area === 'sb';
    const isCommander = area === 'commander' || area === 'command';

    const count = Number(rawCount) || 1;
    if (rawName || scryfallId) {
      parsed.push({
        name: rawName || 'Tuntematon kortti',
        count: Math.max(1, count),
        source: 'csv',
        scryfall_id: scryfallId,
        set,
        collector_number: collectorNumber,
        isSideboard,
        isCommander,
      });
    }
  }

  return parsed;
}

/** Parses JSON export from MTG-apuri, ManaBox, Moxfield, Archidekt, or generic card arrays */
export function parseJsonImport(rawText: string): ParsedDeckEntry[] {
  try {
    const data = JSON.parse(rawText);
    const parsed: ParsedDeckEntry[] = [];

    const extractEntry = (
      item: Record<string, unknown> | null | undefined,
      defaultSideboard = false,
      defaultCommander = false,
    ): ParsedDeckEntry | null => {
      if (!item || typeof item !== 'object') return null;
      const card = (item.card && typeof item.card === 'object' ? item.card : (item.name ? item : null)) as Record<string, unknown> | null;
      if (!card && !item.name) return null;

      const name = String(card?.name || item.name || '').trim();
      if (!name) return null;

      const rawCount = Number(item.count ?? item.quantity ?? item.qty ?? 1);
      const count = Number.isFinite(rawCount) && rawCount > 0 ? rawCount : 1;

      const scryfall_id = (card?.id || item.id || card?.scryfall_id || item.scryfall_id)
        ? String(card?.id || item.id || card?.scryfall_id || item.scryfall_id)
        : undefined;
      const set = (card?.set || item.set) ? String(card?.set || item.set).toLowerCase().trim() : undefined;
      const collector_number = (card?.collector_number || item.collector_number || item.collectorNumber)
        ? String(card?.collector_number || item.collector_number || item.collectorNumber).trim()
        : undefined;

      const isSideboard = Boolean(item.isSideboard || item.sideboard || defaultSideboard);
      const isCommander = Boolean(item.isCommander || item.commander || defaultCommander);

      return {
        name,
        count,
        source: 'json',
        scryfall_id,
        set,
        collector_number,
        isSideboard,
        isCommander,
      };
    };

    if (Array.isArray(data)) {
      for (const item of data) {
        const entry = extractEntry(item as Record<string, unknown>);
        if (entry) parsed.push(entry);
      }
    } else if (typeof data === 'object' && data !== null) {
      const obj = data as Record<string, unknown>;

      // 1. App export with decks
      if (Array.isArray(obj.decks) && obj.decks.length > 0) {
        for (const deck of obj.decks as Array<Record<string, unknown>>) {
          const commanderId = deck.commanderCardId;
          if (Array.isArray(deck.cards)) {
            for (const c of deck.cards as Array<Record<string, unknown>>) {
              const cardObj = c.card as Record<string, unknown> | undefined;
              const isCmd = Boolean(commanderId && (c.cardId === commanderId || cardObj?.id === commanderId));
              const entry = extractEntry(c, false, isCmd);
              if (entry) parsed.push(entry);
            }
          }
        }
      }

      // 2. App export with collection
      if (Array.isArray(obj.collection)) {
        for (const c of obj.collection as Array<Record<string, unknown>>) {
          const entry = extractEntry(c);
          if (entry) parsed.push(entry);
        }
      }

      // 3. Single deck object with cards array
      if (Array.isArray(obj.cards)) {
        const commanderId = obj.commanderCardId;
        for (const c of obj.cards as Array<Record<string, unknown>>) {
          const cardObj = c.card as Record<string, unknown> | undefined;
          const isCmd = Boolean(commanderId && (c.cardId === commanderId || cardObj?.id === commanderId));
          const entry = extractEntry(c, false, isCmd);
          if (entry) parsed.push(entry);
        }
      }

      // 4. Moxfield / Archidekt style (commanders, mainboard, sideboard)
      if (Array.isArray(obj.commanders)) {
        for (const c of obj.commanders as Array<Record<string, unknown>>) {
          const entry = extractEntry(c, false, true);
          if (entry) parsed.push(entry);
        }
      }
      if (Array.isArray(obj.mainboard)) {
        for (const c of obj.mainboard as Array<Record<string, unknown>>) {
          const entry = extractEntry(c, false, false);
          if (entry) parsed.push(entry);
        }
      }
      if (Array.isArray(obj.sideboard)) {
        for (const c of obj.sideboard as Array<Record<string, unknown>>) {
          const entry = extractEntry(c, true, false);
          if (entry) parsed.push(entry);
        }
      }
    }

    return parsed;
  } catch {
    return [];
  }
}

/** Formats a deck into MTG Arena text format */
export function formatArenaExport(
  _deckName: string,
  cards: Array<{ card: { name: string; set: string; collector_number: string }; count: number; isSideboard?: boolean }>,
  commanderCardId?: string,
): string {
  const commanderCards = cards.filter((c) => !c.isSideboard && (commanderCardId ? (c as any).cardId === commanderCardId : false));
  const mainCards = cards.filter((c) => !c.isSideboard && !commanderCards.includes(c));
  const sideCards = cards.filter((c) => c.isSideboard);

  const lines: string[] = [];

  if (commanderCards.length > 0) {
    lines.push('Commander');
    for (const c of commanderCards) {
      lines.push(`${c.count} ${c.card.name} (${c.card.set.toUpperCase()}) ${c.card.collector_number}`);
    }
    lines.push('');
  }

  lines.push('Deck');
  for (const c of mainCards) {
    lines.push(`${c.count} ${c.card.name} (${c.card.set.toUpperCase()}) ${c.card.collector_number}`);
  }

  if (sideCards.length > 0) {
    lines.push('');
    lines.push('Sideboard');
    for (const c of sideCards) {
      lines.push(`${c.count} ${c.card.name} (${c.card.set.toUpperCase()}) ${c.card.collector_number}`);
    }
  }

  return lines.join('\n');
}
