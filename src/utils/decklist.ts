export type ParsedDeckEntry = {
  name: string;
  count: number;
  source: string;
  set?: string;
  collector_number?: string;
  isSideboard?: boolean;
};

export function parseDecklistText(rawText: string): ParsedDeckEntry[] {
  if (!rawText || !rawText.trim()) return [];

  const rawLines = rawText.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const parsed: ParsedDeckEntry[] = [];
  let inSideboard = false;

  for (let line of rawLines) {
    // Check section headers (e.g. "Sideboard", "SB:", "// Sideboard", "Mainboard", "// Main")
    if (/^(\/\/\s*)?(sideboard|sb:|board|side)\b/i.test(line)) {
      inSideboard = true;
      continue;
    }
    if (/^(\/\/\s*)?(mainboard|main deck|deck|main)\b/i.test(line)) {
      inSideboard = false;
      continue;
    }
    if (/^(\/\/\s*)?(commander|general)\b/i.test(line)) {
      inSideboard = false;
      continue;
    }
    // Skip general comment lines
    if (line.startsWith('//')) {
      continue;
    }

    let isSideboard = inSideboard;
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

    let name = remainder.trim();
    // Clean up double-face slashes if present (e.g. "Delver of Secrets // Insectile Aberration" -> keep full or primary)
    if (name) {
      parsed.push({
        name,
        count,
        source: 'decklist',
        set,
        collector_number: collectorNumber,
        isSideboard,
      });
    }
  }

  return parsed;
}

export function parseCsvImport(rawText: string): ParsedDeckEntry[] {
  if (!rawText || !rawText.trim()) return [];

  const lines = rawText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  const parsed: ParsedDeckEntry[] = [];

  for (const line of lines) {
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
    if (cells.length < 2) continue;

    const first = cells[0];
    const second = cells[1];
    const count = Number(first.replace(/x/i, ''));

    if (!Number.isFinite(count) || count <= 0) {
      continue;
    }

    const name = second.replace(/^"|"$/g, '').trim();
    const set = cells[2]?.replace(/^"|"$/g, '').toLowerCase() || undefined;
    const collectorNumber = cells[4]?.replace(/^"|"$/g, '').trim() || undefined;
    const area = cells[5]?.replace(/^"|"$/g, '').toLowerCase();
    const isSideboard = area === 'sideboard' || area === 'sb';

    if (name) {
      parsed.push({
        name,
        count,
        source: 'csv',
        set,
        collector_number: collectorNumber,
        isSideboard,
      });
    }
  }

  return parsed;
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
