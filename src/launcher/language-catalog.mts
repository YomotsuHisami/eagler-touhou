export interface LanguageCatalogEntry {
  id: string;
  title?: string;
  pack?: unknown;
  packageFile?: string;
  packageObjectId?: string;
  packageBytes?: number;
  [key: string]: unknown;
}

export interface LocalLanguagePackSource {
  language: string;
  packageObjectId: string;
  packageFile?: string;
  bytes: number;
  packageLocal: true;
}

export interface RemoteLanguagePackSource {
  language: string;
  url: string;
  sha256: string;
  bytes: number;
  packageLocal?: never;
  [key: string]: unknown;
}

export type LanguagePackSource = LocalLanguagePackSource | RemoteLanguagePackSource;

interface InstalledLanguageGeneration {
  descriptor?: {
    components?: {
      language?: {
        entries?: Array<{ id: string; title?: string; file: string }>;
      };
    };
    files?: Record<string, { bytes?: unknown }>;
  };
  files?: Partial<Record<string, { objectId?: string }>>;
}

const ORIGINAL_LANGUAGE: LanguageCatalogEntry = Object.freeze({
  id: "ja",
  title: "日本語(原版)",
  pack: null,
});

const LANGUAGE_DISPLAY_NAMES = Object.freeze<Record<string, string>>({
  ja: "日本語(原版)",
  "lang_zh-hans": "中文（简体）",
  "lang_zh-hant": "中文（繁體）",
  lang_en: "English",
  lang_ru: "Русский",
});

type LanguageDisplayNameKey =
  | "gameLanguage.ja"
  | "gameLanguage.zhHans"
  | "gameLanguage.zhHant"
  | "gameLanguage.en"
  | "gameLanguage.ru";

const LANGUAGE_DISPLAY_NAME_KEYS = Object.freeze<Record<string, LanguageDisplayNameKey>>({
  ja: "gameLanguage.ja",
  "lang_zh-hans": "gameLanguage.zhHans",
  "lang_zh-hant": "gameLanguage.zhHant",
  lang_en: "gameLanguage.en",
  lang_ru: "gameLanguage.ru",
});

export function buildLanguageCatalog({
  languageOptions,
  legacyLanguages,
  offlineEntries,
  generation,
  translate,
  priority,
}: {
  languageOptions?: unknown;
  legacyLanguages?: unknown;
  offlineEntries?: unknown;
  generation?: InstalledLanguageGeneration | null;
  translate?: (key: LanguageDisplayNameKey) => string;
  priority: (id: string) => number;
}): LanguageCatalogEntry[] {
  // `languageOptions` is the canonical Host Manifest selection surface.
  // `languages` predates it in schema 1 and remains read-only deployment
  // compatibility; current producers must not depend on this fallback.
  const base = Array.isArray(languageOptions)
    ? languageOptions
    : Array.isArray(legacyLanguages)
      ? [ORIGINAL_LANGUAGE, ...legacyLanguages]
      : [ORIGINAL_LANGUAGE];

  const byId = new Map<string, LanguageCatalogEntry>();
  for (const raw of base) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) continue;
    const id = String((raw as { id?: unknown }).id || "");
    if (!id) continue;
    byId.set(id, { ...(raw as LanguageCatalogEntry), id });
  }
  if (!byId.has("ja")) byId.set("ja", { ...ORIGINAL_LANGUAGE });
  if (Array.isArray(offlineEntries)) {
    for (const raw of offlineEntries) {
      if (!raw || typeof raw !== "object" || Array.isArray(raw)) continue;
      const entry = raw as LanguageCatalogEntry;
      if (typeof entry.id !== "string" || !entry.id || byId.has(entry.id)) continue;
      byId.set(entry.id, { ...entry });
    }
  }

  const packageLanguages = generation?.descriptor?.components?.language?.entries;
  if (Array.isArray(packageLanguages)) {
    for (const packageEntry of packageLanguages) {
      if (!packageEntry || typeof packageEntry.id !== "string" || !packageEntry.id ||
          typeof packageEntry.file !== "string" || !packageEntry.file) continue;
      const ref = generation?.files?.[packageEntry.file];
      if (!ref?.objectId) continue;
      const declaration = generation?.descriptor?.files?.[packageEntry.file];
      const existing = byId.get(packageEntry.id);
      byId.set(packageEntry.id, {
        ...(existing || { id: packageEntry.id, pack: null }),
        title: packageEntry.title || existing?.title || packageEntry.id,
        packageFile: packageEntry.file,
        packageObjectId: ref.objectId,
        packageBytes: Number(declaration?.bytes) || 0,
      });
    }
  }

  return [...byId.values()]
    .map(entry => {
      const titleKey = LANGUAGE_DISPLAY_NAME_KEYS[entry.id];
      const translated = titleKey && translate ? translate(titleKey) : "";
      return {
        ...entry,
        title: translated || LANGUAGE_DISPLAY_NAMES[entry.id] || entry.title || entry.id,
      };
    })
    .sort((a, b) => priority(a.id) - priority(b.id) || a.id.localeCompare(b.id, "en"));
}

export function selectLanguageEntry(entries: readonly LanguageCatalogEntry[], requestedId: string) {
  return entries.find(entry => entry.id === requestedId) || entries[0] || null;
}

export function resolveLanguagePackSource(entry: LanguageCatalogEntry | null, baseUrl: string): LanguagePackSource | null {
  if (!entry) return null;
  if (entry.packageObjectId) {
    return {
      language: entry.id,
      packageObjectId: entry.packageObjectId,
      packageFile: entry.packageFile,
      bytes: entry.packageBytes || 0,
      packageLocal: true as const,
    };
  }
  if (!entry.pack) return null;
  if (!entry.pack || typeof entry.pack !== "object" || Array.isArray(entry.pack)) {
    throw new Error("语言包清单无效");
  }
  const pack = entry.pack as Record<string, unknown>;
  if (typeof pack.url !== "string" || typeof pack.sha256 !== "string" || !Number.isInteger(pack.bytes)) {
    throw new Error("语言包清单无效");
  }
  return {
    ...pack,
    language: entry.id,
    url: new URL(pack.url, baseUrl).href,
    sha256: pack.sha256,
    bytes: Number(pack.bytes),
  };
}

export function thpracLocaleForLanguage(id: string) {
  return id === "lang_zh-hans" ? "zh-CN" : id === "ja" ? "ja-JP" : "en-US";
}
