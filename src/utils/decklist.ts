export type ParsedDeckEntry = {
  name: string;
  count: number;
  source: string;
};

export function parseDecklistText(rawText: string): ParsedDeckEntry[] {
  if (!rawText || !rawText.trim()) return [];

  const lines = rawText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => line.replace(/\/\/.*$/, '').trim())
    .filter(Boolean);

  const parsed: ParsedDeckEntry[] = [];

  for (const line of lines) {
    if (/^(sideboard|sb:|board)$/i.test(line)) continue;

    const match = line.match(/^([0-9]+x?)\s+(.+)$/i);
    if (!match) continue;

    const count = Number(match[1].replace(/x/i, ''));
    let name = match[2].trim();

    if (name) {
      name = name.replace(/\s+\([^)]*\)\s+\d+$/, '');
      name = name.replace(/\s+\([^)]+\)$/, '');
      name = name.replace(/\s+\d+$/, '');
      name = name.trim();
    }

    if (name) {
      parsed.push({ name, count, source: 'decklist' });
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
    const cells = line.split(',').map((cell) => cell.trim().replace(/^"|"$/g, ''));
    if (cells.length < 2) continue;

    const first = cells[0];
    const second = cells[1];
    const count = Number(first.replace(/x/i, ''));

    if (!Number.isFinite(count) || count <= 0) {
      continue;
    }

    const name = second.replace(/^"|"$/g, '').trim();
    if (name) parsed.push({ name, count, source: 'csv' });
  }

  return parsed;
}
