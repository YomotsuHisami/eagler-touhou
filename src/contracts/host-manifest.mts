import { RUNTIME_MANIFEST_FILE, parseRuntimeGenerationPath } from "./runtime-generations.mjs";
import {
  HOST_PROTOCOL,
  isHostRuntimeFeatureId,
  PRODUCT_GAMES,
  isGameId,
  type GameId,
  type HostRuntimeFeatures,
} from "./product-catalog.mjs";
import {
  RESOURCE_MODE_EXTERNAL,
  RESOURCE_MODE_HOSTED,
  RESOURCE_MODE_IMPORT,
  normalizeResourceMode,
  type ResourceMode,
} from "./resource-mode.mjs";

export const HOST_MANIFEST_SCHEMA = "eagler-touhou/host-manifest/1";
export const HOST_MANIFEST_FILE = "host-manifest.json";

export interface HostGameData {
  path: string;
  bytes: number;
  sha256: string;
  version: string;
  layout: string;
  /** Development-only source path used to seed the local Package Store. */
  source?: string;
}

export interface HostMidiManifest {
  files: string[];
  sizes?: number[];
  /** Concrete publication support; false means the Runtime/product must not expose MIDI. */
  supported?: boolean;
  [key: string]: unknown;
}

export interface HostOggManifest {
  version: string;
  files: string[];
  sizes: number[];
  sha256: string[];
  [key: string]: unknown;
}

export interface HostLanguagePack {
  url: string;
  bytes: number;
  sha256: string;
  runtimeVersion: string;
  files?: number;
  [key: string]: unknown;
}

export interface HostLanguageOption {
  id: string;
  title?: string;
  pack: HostLanguagePack | null;
  [key: string]: unknown;
}

export interface HostGameManifest {
  runtime: string;
  multiplayerRuntime?: string;
  gameData: HostGameData;
  music: {
    midi: HostMidiManifest;
    ogg?: HostOggManifest | null;
    [key: string]: unknown;
  };
  features?: HostRuntimeFeatures;
  languageOptions?: HostLanguageOption[];
  languages?: HostLanguageOption[];
  offlineCompatibility?: unknown;
  [key: string]: unknown;
}

export interface HostManifestShared {
  /** Additive schema-1 extension; absent only in legacy/development manifests. */
  runtimeManifest?: typeof RUNTIME_MANIFEST_FILE;
  testBuild?: boolean;
  resourceMode: ResourceMode;
  vanillaFont?: string;
  unicodeFont?: string;
  netplayRelay?: string;
  netplayTelemetry?: string;
  gameDataFallback?: { url: string; hint?: string; [key: string]: unknown };
  originMigration?: { mode: "http-to-https" };
  [key: string]: unknown;
}

export interface HostManifest {
  schema: typeof HOST_MANIFEST_SCHEMA;
  protocol: typeof HOST_PROTOCOL;
  profile: string;
  shared: HostManifestShared;
  games: Partial<Record<GameId, HostGameManifest>>;
  [key: string]: unknown;
}

type UnknownRecord = Record<string, unknown>;

const SHA256 = /^[a-f0-9]{64}$/i;
const SHA256_VERSION = /^sha256-[a-f0-9]{64}$/i;

function isRecord(value: unknown): value is UnknownRecord {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function validMusicFileName(value: unknown, extension: "mid" | "ogg"): value is string {
  return typeof value === "string" &&
    new RegExp(`^[A-Za-z0-9][A-Za-z0-9._-]*\\.${extension}$`, "i").test(value);
}

function validMusicFiles(value: unknown, extension: "mid" | "ogg", allowEmpty: boolean): value is string[] {
  return Array.isArray(value) && (allowEmpty || value.length > 0) &&
    new Set(value).size === value.length && value.every(file => validMusicFileName(file, extension));
}

function validMusicSizes(value: unknown, length: number): value is number[] {
  return Array.isArray(value) && value.length === length &&
    value.every(size => Number.isSafeInteger(size) && size > 0);
}

function validMidiManifest(value: unknown): value is HostMidiManifest {
  if (!isRecord(value) || !validMusicFiles(value.files, "mid", true)) return false;
  return (value.sizes == null || validMusicSizes(value.sizes, value.files.length)) &&
    (value.supported == null || typeof value.supported === "boolean");
}

function validOggManifest(value: unknown): value is HostOggManifest | null | undefined {
  if (value == null) return true;
  if (!isRecord(value)) return false;
  const files = value.files;
  const sizes = value.sizes;
  const sha256 = value.sha256;
  return typeof value.version === "string" && SHA256_VERSION.test(value.version) &&
    validMusicFiles(files, "ogg", false) && validMusicSizes(sizes, files.length) &&
    Array.isArray(sha256) && files.length === sha256.length &&
    sha256.every(hash => typeof hash === "string" && SHA256.test(hash));
}

function validLanguagePack(value: unknown): value is HostLanguagePack {
  return isRecord(value) && typeof value.url === "string" && !!value.url &&
    Number.isSafeInteger(value.bytes) && Number(value.bytes) > 0 &&
    typeof value.sha256 === "string" && SHA256.test(value.sha256) &&
    typeof value.runtimeVersion === "string" && !!value.runtimeVersion &&
    (value.files == null || (Number.isSafeInteger(value.files) && Number(value.files) >= 0));
}

function sameLanguagePack(left: HostLanguagePack, right: HostLanguagePack): boolean {
  return left.url === right.url && left.bytes === right.bytes &&
    left.sha256.toLowerCase() === right.sha256.toLowerCase() &&
    left.runtimeVersion === right.runtimeVersion && left.files === right.files;
}

function validLanguageCatalogs(value: UnknownRecord): boolean {
  const hasLanguages = value.languages != null;
  const hasOptions = value.languageOptions != null;
  // Development and old third-party schema-1 manifests may omit both fields.
  if (!hasLanguages && !hasOptions) return true;
  if (!Array.isArray(value.languages) || !Array.isArray(value.languageOptions)) return false;

  const packaged = new Map<string, HostLanguagePack>();
  for (const raw of value.languages) {
    if (!isRecord(raw) || typeof raw.id !== "string" || !raw.id || raw.id === "ja" ||
        packaged.has(raw.id) || !validLanguagePack(raw.pack)) return false;
    packaged.set(raw.id, raw.pack);
  }

  const selectable = new Set<string>();
  let japanese = 0;
  for (const raw of value.languageOptions) {
    if (!isRecord(raw) || typeof raw.id !== "string" || !raw.id || selectable.has(raw.id)) return false;
    selectable.add(raw.id);
    if (raw.id === "ja") {
      if (raw.pack != null) return false;
      japanese++;
      continue;
    }
    const pack = packaged.get(raw.id);
    if (!pack || !validLanguagePack(raw.pack) || !sameLanguagePack(pack, raw.pack)) return false;
  }
  return japanese === 1 && selectable.size === packaged.size + 1;
}

function validOfflineCompatibility(item: UnknownRecord, resourceMode: ResourceMode, gameId: GameId): boolean {
  if (resourceMode !== RESOURCE_MODE_IMPORT) return true;
  const compatibility = item.offlineCompatibility;
  const gameData = item.gameData;
  if (!isRecord(compatibility) || !isRecord(gameData)) return false;
  const runtimeCompatibility = compatibility.runtimeCompatibility;
  const languages = compatibility.languages;
  const requiredShared = compatibility.requiredShared;
  const product = PRODUCT_GAMES[gameId];
  const expectedShared = "requiredShared" in product ? product.requiredShared : ["/msgothic.ttc", "/unifont.otf"];
  return isRecord(runtimeCompatibility) && isRecord(languages) &&
    compatibility.schema === "eagler-touhou/offline-game-pack/1" &&
    runtimeCompatibility.protocol === HOST_PROTOCOL &&
    runtimeCompatibility.dataLayout === gameData.layout &&
    runtimeCompatibility.versionSource === "offline-pack" &&
    Array.isArray(requiredShared) &&
    expectedShared.every(target => requiredShared.includes(target)) &&
    languages.source === "offline-pack" &&
    Array.isArray(languages.baseline) && languages.baseline.includes("ja");
}

function validHostRuntimeFeatures(value: unknown): value is HostRuntimeFeatures | undefined {
  if (value == null) return true;
  if (!isRecord(value)) return false;
  return Object.entries(value).every(([key, item]) => isHostRuntimeFeatureId(key) && typeof item === "boolean");
}

function validGame(gameId: string, value: unknown, resourceMode: ResourceMode): value is HostGameManifest {
  if (!isGameId(gameId) || !isRecord(value) || typeof value.runtime !== "string" || !value.runtime) return false;
  const music = value.music;
  const gameData = value.gameData;
  if (!isRecord(music) || !validMidiManifest(music.midi) || !isRecord(gameData)) return false;
  const product = PRODUCT_GAMES[gameId];
  // Multiplayer support is a product capability ceiling, not a requirement
  // that every deployment publish the multiplayer Runtime. A deployment may
  // deliberately withhold one title's MP build while keeping the ordinary
  // game available; Launcher availability is derived from this Host field.
  if (value.multiplayerRuntime != null &&
      (!("multiplayerRuntime" in product) || typeof value.multiplayerRuntime !== "string" || !value.multiplayerRuntime)) return false;
  const expectedDataPath = product.package.dataTarget.slice(1);
  const packagePointer = value.package;
  const validExternalPackage = resourceMode !== RESOURCE_MODE_EXTERNAL ||
    (isRecord(packagePointer) && typeof packagePointer.revision === "string" && /^[a-f0-9]{16}$/i.test(packagePointer.revision) &&
      typeof packagePointer.descriptor === "string" && /^[A-Za-z0-9][A-Za-z0-9._-]*\.package\.json$/i.test(packagePointer.descriptor));
  return typeof gameData.version === "string" && SHA256_VERSION.test(gameData.version) &&
    typeof gameData.layout === "string" && SHA256_VERSION.test(gameData.layout) &&
    gameData.path === expectedDataPath &&
    Number.isSafeInteger(gameData.bytes) && Number(gameData.bytes) > 0 &&
    typeof gameData.sha256 === "string" && SHA256.test(gameData.sha256) &&
    validExternalPackage && validHostRuntimeFeatures(value.features) && validOggManifest(music.ogg) &&
    validLanguageCatalogs(value) &&
    validOfflineCompatibility(value, resourceMode, gameId);
}

function validOptionalUrl(value: unknown, protocols: ReadonlySet<string>): value is string | null | undefined {
  if (value == null) return true;
  if (typeof value !== "string" || !value) return false;
  try { return protocols.has(new URL(value).protocol); }
  catch { return false; }
}

function validOriginMigration(value: unknown): value is HostManifestShared["originMigration"] {
  return value == null || (isRecord(value) && value.mode === "http-to-https");
}

export function hostOriginMigrationAvailable(manifest: Pick<HostManifest, "shared">, protocol: string): boolean {
  return protocol === "https:" && manifest.shared.originMigration?.mode === "http-to-https";
}

export function validateHostManifest(value: unknown): HostManifest {
  if (!isRecord(value) || value.schema !== HOST_MANIFEST_SCHEMA || value.protocol !== HOST_PROTOCOL ||
      typeof value.profile !== "string" || !value.profile || !isRecord(value.shared) || !isRecord(value.games)) {
    throw new Error("invalid Host Manifest");
  }
  if (value.shared.testBuild !== undefined && typeof value.shared.testBuild !== "boolean") {
    throw new Error("invalid Host Manifest testBuild flag");
  }
  const resourceMode = normalizeResourceMode(value.shared.resourceMode);
  if (!resourceMode) throw new Error("invalid Host Manifest resource mode");
  if (resourceMode === RESOURCE_MODE_HOSTED &&
      (typeof value.shared.vanillaFont !== "string" || typeof value.shared.unicodeFont !== "string")) {
    throw new Error("hosted Host Manifest is missing shared fonts");
  }
  if (resourceMode !== RESOURCE_MODE_HOSTED &&
      (value.shared.vanillaFont != null || value.shared.unicodeFont != null)) {
    throw new Error(`${resourceMode} Host Manifest must not publish shared font URLs`);
  }
  const fallback = value.shared.gameDataFallback;
  if (fallback != null && (!isRecord(fallback) || typeof fallback.url !== "string" ||
      !validOptionalUrl(fallback.url, new Set(["https:"])) ||
      (fallback.hint != null && typeof fallback.hint !== "string"))) {
    throw new Error("invalid Host Manifest gameDataFallback");
  }
  if (!validOptionalUrl(value.shared.netplayRelay, new Set(["ws:", "wss:"]))) {
    throw new Error("invalid Host Manifest netplayRelay");
  }
  if (!validOptionalUrl(value.shared.netplayTelemetry, new Set(["http:", "https:"]))) {
    throw new Error("invalid Host Manifest netplayTelemetry");
  }
  if (!validOriginMigration(value.shared.originMigration)) {
    throw new Error("invalid Host Manifest originMigration");
  }
  if (value.shared.runtimeManifest != null && value.shared.runtimeManifest !== RUNTIME_MANIFEST_FILE) {
    throw new Error("invalid Host Manifest Runtime pointer");
  }
  if (value.shared.runtimeManifest === RUNTIME_MANIFEST_FILE) {
    for (const game of Object.values(value.games)) {
      if (!isRecord(game)) throw new Error("invalid Host Manifest game");
      for (const field of ["runtime", "multiplayerRuntime"]) {
        if (game[field] == null) continue;
        if (typeof game[field] !== "string") throw new Error("invalid Host Runtime URL");
        const url = new URL(game[field], "https://runtime.invalid/");
        if (url.origin !== "https://runtime.invalid" || !parseRuntimeGenerationPath(url.pathname.slice(1)) || url.searchParams.has("v")) {
          throw new Error("Host Runtime URL must name an immutable generation");
        }
      }
    }
  }
  const games = value.games;
  const actualGames = Object.keys(games).sort();
  if (!actualGames.length || actualGames.some(game => !isGameId(game)) ||
      actualGames.some(game => !validGame(game, games[game], resourceMode))) {
    throw new Error("invalid Host Manifest games");
  }
  return {
    ...value,
    schema: HOST_MANIFEST_SCHEMA,
    protocol: HOST_PROTOCOL,
    profile: value.profile,
    shared: { ...value.shared, resourceMode } as HostManifestShared,
    games: games as Partial<Record<GameId, HostGameManifest>>,
  };
}
