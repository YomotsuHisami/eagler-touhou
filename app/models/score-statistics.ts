import {gameIdForProduct, isMultiplayerProductId, type ProductId} from '../../src/contracts/product-catalog.mts';
import {characterArtForName} from '../../src/contracts/character-art.mts';
import {parseScoreDat, scoreDifficulties, scoreLoadouts, type ScoreReport} from '../../src/launcher/score-dat.mts';
import {readStoredScore, supportsScore, type StoredScore} from '../services/score-storage';

export type ScorePhase = 'idle' | 'loading' | 'empty' | 'ready' | 'unavailable' | 'unreadable' | 'unsupported';
export interface ScoreSnapshot {
  product: ProductId | null;
  phase: ScorePhase;
  report: ScoreReport | null;
  favorite: ReturnType<typeof favoriteLoadout>;
  edition: StoredScore['edition'];
  modified: number | null;
  multiplayer: boolean;
  sourceName: string | null;
}

/** Rankings and clear counts are not evidence of play frequency. */
export function favoriteLoadout(report: Pick<ScoreReport, 'sections'>) {
  const rows = report.sections.find(section => section.title === '各机体开局次数')?.rows.filter(row => row[1] === '合计')
    ?? report.sections.find(section => section.title === '各机体游玩统计')?.rows.filter(row => row[0] !== '合计').map(row => [row[0], '合计', row[1]]) ?? [];
  // Keep original character order for ties; do not sum difficulty totals twice.
  const best = rows.reduce<(typeof rows)[number] | null>((previous, row) => Number(row[2]) > 0 && (!previous || Number(row[2]) > Number(previous[2])) ? row : previous, null);
  return best ? {name: String(best[0]), count: Number(best[2]), portraits: characterArtForName(String(best[0]))} : null;
}

/** Display fallback only: clear counts/coverage never become play frequency. */
export function featuredLoadout(report: Pick<ScoreReport, 'game' | 'sections' | 'clears'>) {
  const favorite = favoriteLoadout(report);
  if (favorite) return {...favorite, basis: 'plays' as const};
  const names = scoreLoadouts(report.game);
  if (!names.length) return null;
  const coverage = names.map((_, column) => scoreDifficulties.reduce((total, _, row) => total + Number(report.clears[row]?.[column] === true), 0));
  // A fully cleared matrix cannot distinguish a representative loadout.
  if (coverage.every(count => count === scoreDifficulties.length)) return null;
  const counts = names.map(() => new Map<string, number>());
  for (const row of report.sections.find(section => section.title === '通关次数')?.rows ?? []) {
    const column = names.indexOf(String(row[0])), difficulty = String(row[1]), count = Number(row[2]);
    if (column < 0 || !scoreDifficulties.includes(difficulty) || !Number.isSafeInteger(count) || count < 0) continue;
    // Totals/unknown names are excluded, and a repeated saved field is not added twice.
    counts[column].set(difficulty, count);
  }
  const totals = counts.map(difficulties => [...difficulties.values()].reduce((total, count) => total + count, 0));
  const mostClears = Math.max(...totals);
  let candidates = names.map((_, column) => column).filter(column => !mostClears || totals[column] === mostClears);
  let basis: 'clears' | 'difficulties' = 'clears', count = mostClears;
  if (!mostClears || candidates.length > 1) {
    count = Math.max(...candidates.map(column => coverage[column]));
    candidates = candidates.filter(column => coverage[column] === count);
    basis = 'difficulties';
  }
  if (!count || candidates.length !== 1) return null;
  const name = names[candidates[0]];
  return {name, count, basis, portraits: characterArtForName(name)};
}

export function createScoreStatistics({read = readStoredScore}: {read?: typeof readStoredScore} = {}) {
  const listeners = new Set<() => void>();
  let snapshot: ScoreSnapshot = Object.freeze({product: null, phase: 'idle', report: null, favorite: null, edition: null, modified: null, multiplayer: false, sourceName: null});
  let language = 'ja', serial = 0, suspended = false, disposed = false;
  const publish = (next: ScoreSnapshot) => {if (disposed) return; snapshot = Object.freeze(next); listeners.forEach(listener => listener());};
  async function refresh() {
    const product = snapshot.product;
    if (disposed || !product || !supportsScore(product)) return;
    const request = ++serial;
    publish({...snapshot, phase: 'loading', report: null, favorite: null, sourceName: null});
    if (suspended) return;
    let stored: StoredScore | null;
    try {stored = await read(product, language);}
    catch {if (!disposed && request === serial) publish({...snapshot, phase: 'unavailable', report: null, favorite: null}); return;}
    if (disposed || request !== serial) return;
    if (!stored) {publish({...snapshot, phase: 'empty', report: null, favorite: null, edition: null, modified: null}); return;}
    try {
      const report = parseScoreDat(gameIdForProduct(product), stored.bytes);
      publish({...snapshot, phase: 'ready', report, favorite: favoriteLoadout(report), edition: stored.edition, modified: stored.modified || null, sourceName: stored.sourceName ?? null});
    } catch {publish({...snapshot, phase: 'unreadable', report: null, favorite: null, edition: stored.edition, modified: stored.modified || null});}
  }
  return {
    subscribe(listener: () => void) {listeners.add(listener); return () => {listeners.delete(listener);};},
    getSnapshot: () => snapshot,
    select(product: ProductId, preferredLanguage: string) {
      if (disposed || snapshot.product === product && language === preferredLanguage) return;
      serial++; language = preferredLanguage;
      publish({product, phase: supportsScore(product) ? 'loading' : 'unsupported', report: null, favorite: null, edition: null, modified: null, multiplayer: isMultiplayerProductId(product), sourceName: null});
      void refresh();
    },
    refresh,
    clear(product?: ProductId) {
      if (disposed || product && snapshot.product !== product) return;
      serial++;
      publish({product: null, phase: 'idle', report: null, favorite: null, edition: null, modified: null, multiplayer: false, sourceName: null});
    },
    invalidate(product?: ProductId) {if (!product || snapshot.product === product) void refresh();},
    suspend(value: boolean) {
      if (disposed || suspended === value) return;
      suspended = value;
      if (value) serial++; else void refresh();
    },
    dispose() {disposed = true; serial++; listeners.clear();},
  };
}
export type ScoreStatistics = ReturnType<typeof createScoreStatistics>;
