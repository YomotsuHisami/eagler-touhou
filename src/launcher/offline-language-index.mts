import type { LanguageCatalogEntry, RemoteLanguagePackSource } from "./language-catalog.mjs";

export const offlineLanguageIndexKey = (game: string) => `eagler-touhou-${game}-offline-language-index-v1`;

export function loadOfflineLanguageIndex(storage: Storage | null, game: string): LanguageCatalogEntry[] {
  if (!storage) return [];
  try {
    const value = JSON.parse(storage.getItem(offlineLanguageIndexKey(game)) || "[]");
    if (!Array.isArray(value)) return [];
    return value.filter(entry => entry && typeof entry.id === "string" && entry.id && entry.pack &&
      typeof entry.pack.url === "string" && /^[a-f0-9]{64}$/i.test(String(entry.pack.sha256 || "")) &&
      Number.isInteger(entry.pack.bytes) && entry.pack.bytes >= 0);
  } catch { return []; }
}

export function rememberOfflineLanguage(
  storage: Storage | null,
  game: string,
  entry: LanguageCatalogEntry | null,
  pack: RemoteLanguagePackSource,
): boolean {
  if (!storage || !entry?.id) return false;
  try {
    const entries = loadOfflineLanguageIndex(storage, game);
    const next = entries.filter(item => item.id !== entry.id);
    next.push({ id: entry.id, title: entry.title, pack: { url: pack.url, sha256: pack.sha256, bytes: pack.bytes } });
    storage.setItem(offlineLanguageIndexKey(game), JSON.stringify(next));
    return true;
  } catch { return false; }
}
