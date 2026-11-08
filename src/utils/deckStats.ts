import type { DeckCard } from '../types';

export interface ManaCurveBucket {
  cmc: number;
  label: string;
  count: number;
}

export interface TypeBreakdown {
  category: string;
  count: number;
  percentage: number;
}

export interface ColorPipCount {
  color: string;
  symbol: string;
  label: string;
  count: number;
  bgClass: string;
  textClass: string;
}

export interface DeckStatsResult {
  totalCards: number;
  mainboardCards: number;
  sideboardCards: number;
  landCount: number;
  nonLandCount: number;
  avgCmcWithoutLands: number;
  avgCmcWithLands: number;
  curve: ManaCurveBucket[];
  maxCurveCount: number;
  types: TypeBreakdown[];
  colors: ColorPipCount[];
  totalPriceEur: number;
  totalPriceUsd: number;
  unpricedCount: number;
  commanderViolations: string[];
  duplicateViolations: string[];
}

const BASIC_LANDS = new Set([
  'plains',
  'island',
  'swamp',
  'mountain',
  'forest',
  'wastes',
  'snow-covered plains',
  'snow-covered island',
  'snow-covered swamp',
  'snow-covered mountain',
  'snow-covered forest',
]);

export function calculateDeckStats(
  cards: DeckCard[],
  commanderCardId?: string,
  isCommanderDeck?: boolean,
): DeckStatsResult {
  const mainCards = cards.filter((c) => !c.isSideboard);
  const sideCards = cards.filter((c) => c.isSideboard);

  const mainboardCount = mainCards.reduce((acc, c) => acc + c.count, 0);
  const sideboardCount = sideCards.reduce((acc, c) => acc + c.count, 0);

  // Mana curve: 0 to 7+ (excluding lands)
  const curveMap: Record<number, number> = { 0: 0, 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0, 7: 0 };
  let nonLandCount = 0;
  let landCount = 0;
  let totalCmcNonLand = 0;
  let totalCmcAll = 0;

  // Types
  const typeMap: Record<string, number> = {
    Creature: 0,
    Instant: 0,
    Sorcery: 0,
    Artifact: 0,
    Enchantment: 0,
    Planeswalker: 0,
    Battle: 0,
    Land: 0,
    Other: 0,
  };

  // Color pips
  const pips: Record<string, number> = { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 };

  // Prices
  let totalPriceEur = 0;
  let totalPriceUsd = 0;
  let unpricedCount = 0;

  for (const entry of cards) {
    const card = entry.card;
    const isLand = (card.type_line || '').toLowerCase().includes('land');
    const eur = card.prices?.eur ? parseFloat(card.prices.eur) : null;
    const usd = card.prices?.usd ? parseFloat(card.prices.usd) : null;

    if (eur && !isNaN(eur)) {
      totalPriceEur += eur * entry.count;
    } else {
      unpricedCount += entry.count;
    }

    if (usd && !isNaN(usd)) {
      totalPriceUsd += usd * entry.count;
    }

    if (entry.isSideboard) continue;

    // CMC & types for maindeck
    const cmc = Math.floor(card.cmc ?? 0);
    totalCmcAll += (card.cmc ?? 0) * entry.count;

    if (isLand) {
      landCount += entry.count;
    } else {
      nonLandCount += entry.count;
      totalCmcNonLand += (card.cmc ?? 0) * entry.count;
      const bucket = Math.min(Math.max(cmc, 0), 7);
      curveMap[bucket] = (curveMap[bucket] || 0) + entry.count;
    }

    // Types
    const typeLine = (card.type_line || '').toLowerCase();
    let categorized = false;
    if (typeLine.includes('creature')) {
      typeMap.Creature += entry.count;
      categorized = true;
    }
    if (typeLine.includes('instant')) {
      typeMap.Instant += entry.count;
      categorized = true;
    }
    if (typeLine.includes('sorcery')) {
      typeMap.Sorcery += entry.count;
      categorized = true;
    }
    if (typeLine.includes('artifact') && !typeLine.includes('creature')) {
      typeMap.Artifact += entry.count;
      categorized = true;
    }
    if (typeLine.includes('enchantment') && !typeLine.includes('creature')) {
      typeMap.Enchantment += entry.count;
      categorized = true;
    }
    if (typeLine.includes('planeswalker')) {
      typeMap.Planeswalker += entry.count;
      categorized = true;
    }
    if (typeLine.includes('battle')) {
      typeMap.Battle += entry.count;
      categorized = true;
    }
    if (typeLine.includes('land') && !categorized) {
      typeMap.Land += entry.count;
      categorized = true;
    }
    if (!categorized) {
      typeMap.Other += entry.count;
    }

    // Color pips from mana_cost or card_faces
    const manaCosts = [card.mana_cost, ...(card.card_faces?.map((f) => f.mana_cost) || [])].filter(Boolean) as string[];
    for (const cost of manaCosts) {
      const matches = cost.match(/\{([WUBRGC])\}/g);
      if (matches) {
        for (const m of matches) {
          const symbol = m.replace(/[{}]/g, '');
          if (pips[symbol] !== undefined) {
            pips[symbol] += entry.count;
          }
        }
      }
    }
  }

  const curve: ManaCurveBucket[] = [0, 1, 2, 3, 4, 5, 6, 7].map((num) => ({
    cmc: num,
    label: num === 7 ? '7+' : String(num),
    count: curveMap[num] || 0,
  }));
  const maxCurveCount = Math.max(1, ...curve.map((b) => b.count));

  const typeLabels: Record<string, string> = {
    Creature: 'Olennot',
    Instant: 'Instantit',
    Sorcery: 'Sorceryt',
    Artifact: 'Artefaktit',
    Enchantment: 'Enchantmentit',
    Planeswalker: 'Planeswalkerit',
    Battle: 'Battlet',
    Land: 'Maat',
    Other: 'Muut',
  };

  const types: TypeBreakdown[] = Object.entries(typeMap)
    .filter(([, count]) => count > 0)
    .map(([key, count]) => ({
      category: typeLabels[key] || key,
      count,
      percentage: mainboardCount > 0 ? Math.round((count / mainboardCount) * 100) : 0,
    }))
    .sort((a, b) => b.count - a.count);

  const colors: ColorPipCount[] = [
    { color: 'W', symbol: '{W}', label: 'Valkoinen', count: pips.W, bgClass: 'bg-amber-100', textClass: 'text-amber-900' },
    { color: 'U', symbol: '{U}', label: 'Sininen', count: pips.U, bgClass: 'bg-sky-500', textClass: 'text-white' },
    { color: 'B', symbol: '{B}', label: 'Musta', count: pips.B, bgClass: 'bg-slate-700', textClass: 'text-white' },
    { color: 'R', symbol: '{R}', label: 'Punainen', count: pips.R, bgClass: 'bg-rose-500', textClass: 'text-white' },
    { color: 'G', symbol: '{G}', label: 'Vihreä', count: pips.G, bgClass: 'bg-emerald-500', textClass: 'text-white' },
    { color: 'C', symbol: '{C}', label: 'Väritön', count: pips.C, bgClass: 'bg-stone-500', textClass: 'text-white' },
  ].filter((c) => c.count > 0);

  // Commander validations
  const commanderViolations: string[] = [];
  const duplicateViolations: string[] = [];

  const commanderEntry = commanderCardId ? cards.find((c) => c.cardId === commanderCardId) : undefined;
  const isCommander = isCommanderDeck || Boolean(commanderCardId);

  if (isCommander && commanderEntry) {
    const commanderColors = new Set(commanderEntry.card.color_identity || []);
    for (const entry of mainCards) {
      const cardColors = entry.card.color_identity || [];
      const illegalColors = cardColors.filter((col) => !commanderColors.has(col));
      if (illegalColors.length > 0) {
        commanderViolations.push(`${entry.card.name} sisältää värin (${illegalColors.join(', ')}), joka ei kuulu commanderin väreihin.`);
      }
    }
  }

  if (isCommander) {
    for (const entry of mainCards) {
      if (entry.count > 1 && !BASIC_LANDS.has(entry.card.name.toLowerCase())) {
        duplicateViolations.push(`${entry.card.name} (${entry.count} kpl) – Commander-pakassa saa olla vain 1 kpl kutakin ei-perusmaata.`);
      }
    }
  }

  return {
    totalCards: mainboardCount + sideboardCount,
    mainboardCards: mainboardCount,
    sideboardCards: sideboardCount,
    landCount,
    nonLandCount,
    avgCmcWithoutLands: nonLandCount > 0 ? parseFloat((totalCmcNonLand / nonLandCount).toFixed(2)) : 0,
    avgCmcWithLands: mainboardCount > 0 ? parseFloat((totalCmcAll / mainboardCount).toFixed(2)) : 0,
    curve,
    maxCurveCount,
    types,
    colors,
    totalPriceEur: parseFloat(totalPriceEur.toFixed(2)),
    totalPriceUsd: parseFloat(totalPriceUsd.toFixed(2)),
    unpricedCount,
    commanderViolations,
    duplicateViolations,
  };
}
