export const HOST_PROTOCOL = "eagler-touhou/1";

export type ProductFeatureId = "thprac" | "replayManagement" | "languages" | "focusHitbox";
export type HostRuntimeFeatureId = "thprac" | "focusHitbox";
export type HostRuntimeFeatures = Readonly<Partial<Record<HostRuntimeFeatureId, boolean>>>;

export function languagePriority(id: string): number {
  return id === "ja" ? 0
    : id === "lang_zh-hans" ? 10
    : id === "lang_zh-hant" ? 11
    : id === "lang_en" ? 20
    : 100;
}

export const PRODUCT_GAMES = Object.freeze({
  th06: Object.freeze({
    cardArtwork: "th06-card.webp",
    number: "06",
    title: "東方紅魔郷",
    subtitle: "the Embodiment of Scarlet Devil",
    storage: Object.freeze({
      saveRoot: "/savesth06",
      scoreFile: "score.dat",
      configFiles: Object.freeze(["東方紅魔郷.cfg", "th06.cfg"]),
    }),
    runtime: "./runtime/th06/th06.html",
    dataProvider: "emscripten-preload",
    package: Object.freeze({
      dataFileId: "game-data",
      dataTarget: "/th06.data",
      musicSourceDirectories: Object.freeze({ wav: "bgm", ogg: "bgm" }),
      musicMounts: Object.freeze({ wav: "/bgm", ogg: "/bgm" }),
    }),
    replay: Object.freeze({ prefix: "th6" }),
    multiplayerRuntime: "./runtime/th06/multiplayer/th06.html",
    multiplayer: Object.freeze({
      difficultyMax: 4,
      characterMax: 1,
      loadoutCount: 4,
      peerTransportGlobal: "__th06PeerTransport",
    }),
    features: Object.freeze({ thprac: true, replayManagement: true, languages: true, focusHitbox: true }),
  }),
  th07: Object.freeze({
    cardArtwork: "th07-card.webp",
    number: "07",
    title: "東方妖々夢",
    subtitle: "Perfect Cherry Blossom",
    storage: Object.freeze({
      saveRoot: "/savesth07",
      scoreFile: "score.dat",
      configFiles: Object.freeze(["th07.cfg"]),
    }),
    runtime: "./runtime/th07/th07.html",
    dataProvider: "emscripten-preload",
    package: Object.freeze({
      dataFileId: "game-data",
      dataTarget: "/th07.data",
      musicSourceDirectories: Object.freeze({ wav: ".", ogg: "bgm-ogg" }),
      musicMounts: Object.freeze({ wav: "/", ogg: "/bgm-ogg" }),
    }),
    replay: Object.freeze({ prefix: "th7" }),
    multiplayerRuntime: "./runtime/th07/multiplayer/th07.html",
    multiplayer: Object.freeze({
      difficultyMax: 5,
      characterMax: 2,
      loadoutCount: 6,
      peerTransportGlobal: "__th07PeerTransport",
    }),
    features: Object.freeze({ thprac: true, replayManagement: true, languages: true, focusHitbox: false }),
  }),
  th08: Object.freeze({
    cardArtwork: "th08-card.webp",
    number: "08",
    title: "東方永夜抄",
    subtitle: "Imperishable Night",
    storage: Object.freeze({
      saveRoot: "/savesth08",
      scoreFile: "score.dat",
      configFiles: Object.freeze(["th08.cfg"]),
    }),
    runtime: "./runtime/th08/th08-modern.html",
    runtimeFileLayout: "directory",
    requiredShared: Object.freeze([]),
    runtimeAssets: Object.freeze([
      "th08-modern.html",
      "manifest.json",
      "shell.mjs",
      "eagler-host.mjs",
      "motion-replay.mjs",
      "th08-sdl.mjs",
      "th08-sdl.wasm",
      "resources.json",
      "fonts/msgothic.ttc",
      "fonts/blend.bin",
      "fonts/cp932.bin",
    ]),
    dataProvider: "retail-memory",
    package: Object.freeze({
      dataFileId: "game-data",
      dataTarget: "/th08.data",
      musicSourceDirectories: Object.freeze({ ogg: "bgm-ogg" }),
      musicMounts: Object.freeze({ ogg: "/bgm-ogg" }),
    }),
    features: Object.freeze({ thprac: false, replayManagement: false, languages: false, focusHitbox: false }),
  }),
  th10: Object.freeze({
    cardArtwork: "th10-card.webp",
    number: "10",
    title: "東方風神録",
    subtitle: "Mountain of Faith",
    storage: Object.freeze({ saveRoot: "/savesth10", scoreFile: "scoreth10.dat", configFiles: Object.freeze(["th10.cfg"]) }),
    runtime: "./runtime/th10/th10.html",
    runtimeFileLayout: "directory",
    requiredShared: Object.freeze([]),
    runtimeAssets: Object.freeze([
      "th10.html",
      "manifest.json",
      "shell.mjs",
      "eagler-host.mjs",
      "motion-replay.mjs",
      "th10-sdl.mjs",
      "th10-sdl.wasm",
      "resources.json",
      "fonts/msgothic.ttc",
      "fonts/simhei.ttf",
      "fonts/blend.bin",
      "fonts/codepages.bin",
    ]),
    dataProvider: "retail-memory",
    package: Object.freeze({
      dataFileId: "game-data", dataTarget: "/th10.data",
      musicSourceDirectories: Object.freeze({ ogg: "bgm-ogg" }),
      musicMounts: Object.freeze({ ogg: "/bgm-ogg" }),
    }),
    features: Object.freeze({ thprac: false, replayManagement: false, languages: false, focusHitbox: false }),
  }),
});

export type GameId = keyof typeof PRODUCT_GAMES;
export type ProductGame = (typeof PRODUCT_GAMES)[GameId];
export type MultiplayerGameId = {
  [K in GameId]: (typeof PRODUCT_GAMES)[K] extends { readonly multiplayerRuntime: string } ? K : never;
}[GameId];
export type MultiplayerProductId = `${MultiplayerGameId}mp`;
export type ProductId = GameId | MultiplayerProductId;
export interface MultiplayerProductConfig {
  difficultyMax: number;
  characterMax: number;
  loadoutCount: number;
  peerTransportGlobal: string;
}

const productGameEntries = Object.entries(PRODUCT_GAMES) as Array<[GameId, ProductGame]>;
const multiplayerProductGames = Object.freeze(Object.fromEntries(
  productGameEntries
    .filter((entry): entry is [MultiplayerGameId, Extract<ProductGame, { readonly multiplayerRuntime: string }>] =>
      "multiplayerRuntime" in entry[1] && "multiplayer" in entry[1])
    .map(([gameId]) => [`${gameId}mp`, gameId]),
)) as Readonly<Partial<Record<MultiplayerProductId, MultiplayerGameId>>>;

export const PRODUCT_IDS = Object.freeze([
  ...Object.keys(PRODUCT_GAMES),
  ...Object.keys(multiplayerProductGames),
]) as readonly ProductId[];

export function isGameId(value: string): value is GameId {
  return Object.hasOwn(PRODUCT_GAMES, value);
}

export function productEnabledForBuild(productId: string, testBuild = false): boolean {
  if (!isProductId(productId)) return false;
  const game = PRODUCT_GAMES[gameIdForProduct(productId as ProductId)];
  return !("testOnly" in game && game.testOnly) || testBuild === true;
}

export function isProductId(value: string): value is ProductId {
  return PRODUCT_IDS.includes(value as ProductId);
}

export function isMultiplayerProductId(productId: string): productId is MultiplayerProductId {
  return Object.hasOwn(multiplayerProductGames, productId);
}

export function gameIdForProduct(productId: ProductId): GameId;
export function gameIdForProduct(productId: string): GameId | string;
export function gameIdForProduct(productId: string): GameId | string {
  return isMultiplayerProductId(productId) ? multiplayerProductGames[productId] ?? productId : productId;
}

export function multiplayerProductIdForGame(gameId: string): MultiplayerProductId | null {
  const productId = `${gameId}mp`;
  return isMultiplayerProductId(productId) ? productId : null;
}

export function multiplayerConfigForProduct(productId: string): MultiplayerProductConfig | null {
  const gameId = gameIdForProduct(productId);
  if (!isGameId(gameId)) return null;
  const product = PRODUCT_GAMES[gameId];
  return "multiplayer" in product
    ? product.multiplayer as MultiplayerProductConfig
    : null;
}

const HOST_RUNTIME_FEATURES = new Set<ProductFeatureId>(["thprac", "focusHitbox"]);

// Static product policy is the capability ceiling. A Host may report that its
// concrete Runtime lacks an attested Runtime feature, but it cannot enable a
// feature the product does not support or override Launcher-owned features.
// Missing Host fields preserve host-manifest/1 deployments from before Runtime
// capability attestation became explicit.
export function productFeatureAvailable(
  gameId: string,
  featureId: ProductFeatureId,
  hostFeatures: HostRuntimeFeatures | null = null,
): boolean {
  const supported = isGameId(gameId) && PRODUCT_GAMES[gameId].features[featureId] === true;
  if (!supported || !HOST_RUNTIME_FEATURES.has(featureId)) return supported;
  const hosted = hostFeatures?.[featureId as HostRuntimeFeatureId];
  return hosted == null ? true : hosted === true;
}

export function createLocalProductManifest() {
  return {
    protocol: HOST_PROTOCOL,
    shared: { resourceMode: "hosted" as const, testBuild: false },
    games: Object.fromEntries(productGameEntries.map(([game, product]) => [game, {
      ...product,
      music: { midi: { files: [] } },
      languageOptions: [{ id: "ja", title: "日本語(原版)", pack: null }],
    }])),
  };
}
