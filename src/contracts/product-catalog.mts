export const HOST_PROTOCOL = "eagler-touhou/1";

// Product features are declarations for genuine per-game differences. Required
// all-game adapter capabilities live in adapter-capabilities.mts and must not be
// added here as booleans that a title can opt out of.
//
// Keep the three publication layers explicit:
// - product: static capability ceiling/difference;
// - Runtime Release: concrete build attestation (all entries below);
// - Host Manifest: only features the Launcher must query as booleans at run
//   time. Some capabilities have a richer Host surface instead: languages are
//   represented by languages/languageOptions rather than a duplicate flag.
export const PRODUCT_FEATURE_POLICY = Object.freeze({
  thprac: Object.freeze({ runtimeRelease: true, hostManifestFeature: true, hostSurface: "features.thprac", hostValueSource: "server-request-and-runtime" }),
  languages: Object.freeze({ runtimeRelease: true, hostManifestFeature: false, hostSurface: "languages + languageOptions", hostValueSource: "language-catalog" }),
  focusHitbox: Object.freeze({ runtimeRelease: true, hostManifestFeature: true, hostSurface: "features.focusHitbox", hostValueSource: "runtime-release" }),
} as const);
export type ProductFeatureId = keyof typeof PRODUCT_FEATURE_POLICY;
export const PRODUCT_FEATURE_IDS = Object.freeze(Object.keys(PRODUCT_FEATURE_POLICY) as ProductFeatureId[]);
export type HostRuntimeFeatureId = {
  [K in ProductFeatureId]: (typeof PRODUCT_FEATURE_POLICY)[K]["hostManifestFeature"] extends true ? K : never;
}[ProductFeatureId];
export const HOST_RUNTIME_FEATURE_IDS = Object.freeze(Object.entries(PRODUCT_FEATURE_POLICY)
  .filter(([, policy]) => policy.hostManifestFeature)
  .map(([id]) => id as HostRuntimeFeatureId));
export type HostRuntimeFeatures = Readonly<Partial<Record<HostRuntimeFeatureId, boolean>>>;

export function isHostRuntimeFeatureId(value: string): value is HostRuntimeFeatureId {
  return (HOST_RUNTIME_FEATURE_IDS as readonly string[]).includes(value);
}

export function languagePriority(id: string): number {
  return id === "ja" ? 0
    : id === "lang_zh-hans" ? 10
    : id === "lang_zh-hant" ? 11
    : id === "lang_en" ? 20
    : 100;
}

const REIMU_A = Object.freeze({ labelKey: "multiplayer.loadout.reimuA", glyph: "霊", character: 0, shot: 0 });
const REIMU_B = Object.freeze({ labelKey: "multiplayer.loadout.reimuB", glyph: "霊", character: 0, shot: 1 });
const MARISA_A = Object.freeze({ labelKey: "multiplayer.loadout.marisaA", glyph: "魔", character: 1, shot: 0 });
const MARISA_B = Object.freeze({ labelKey: "multiplayer.loadout.marisaB", glyph: "魔", character: 1, shot: 1 });
const SAKUYA_A = Object.freeze({ labelKey: "multiplayer.loadout.sakuyaA", glyph: "咲", character: 2, shot: 0 });
const SAKUYA_B = Object.freeze({ labelKey: "multiplayer.loadout.sakuyaB", glyph: "咲", character: 2, shot: 1 });
const REIMU_C = Object.freeze({ labelKey: "multiplayer.loadout.reimuC", glyph: "霊", character: 0, shot: 2 });
const MARISA_C = Object.freeze({ labelKey: "multiplayer.loadout.marisaC", glyph: "魔", character: 1, shot: 2 });
const TH06_MULTIPLAYER_LOADOUTS = Object.freeze([REIMU_A, REIMU_B, MARISA_A, MARISA_B]);
const TH07_MULTIPLAYER_LOADOUTS = Object.freeze([...TH06_MULTIPLAYER_LOADOUTS, SAKUYA_A, SAKUYA_B]);
const TH08_MULTIPLAYER_LOADOUTS = Object.freeze([
  Object.freeze({ labelKey: "multiplayer.loadout.th08.reimuYukari", glyph: "霊", character: 0, shot: 0 }),
  Object.freeze({ labelKey: "multiplayer.loadout.th08.marisaAlice", glyph: "魔", character: 1, shot: 0 }),
  Object.freeze({ labelKey: "multiplayer.loadout.th08.sakuyaRemilia", glyph: "咲", character: 2, shot: 0 }),
  Object.freeze({ labelKey: "multiplayer.loadout.th08.youmuYuyuko", glyph: "妖", character: 3, shot: 0 }),
  Object.freeze({ labelKey: "multiplayer.loadout.th08.reimu", glyph: "霊", character: 4, shot: 0 }),
  Object.freeze({ labelKey: "multiplayer.loadout.th08.yukari", glyph: "紫", character: 5, shot: 0 }),
  Object.freeze({ labelKey: "multiplayer.loadout.th08.marisa", glyph: "魔", character: 6, shot: 0 }),
  Object.freeze({ labelKey: "multiplayer.loadout.th08.alice", glyph: "愛", character: 7, shot: 0 }),
  Object.freeze({ labelKey: "multiplayer.loadout.th08.sakuya", glyph: "咲", character: 8, shot: 0 }),
  Object.freeze({ labelKey: "multiplayer.loadout.th08.remilia", glyph: "蕾", character: 9, shot: 0 }),
  Object.freeze({ labelKey: "multiplayer.loadout.th08.youmu", glyph: "妖", character: 10, shot: 0 }),
  Object.freeze({ labelKey: "multiplayer.loadout.th08.yuyuko", glyph: "幽", character: 11, shot: 0 }),
]);
const TH10_MULTIPLAYER_LOADOUTS = Object.freeze([REIMU_A, REIMU_B, REIMU_C, MARISA_A, MARISA_B, MARISA_C]);
const STANDARD_MULTIPLAYER_DIFFICULTIES = Object.freeze(["Easy", "Normal", "Hard", "Lunatic", "Extra"]);
const TH07_MULTIPLAYER_DIFFICULTIES = Object.freeze([...STANDARD_MULTIPLAYER_DIFFICULTIES, "Phantasm"]);
const TH09_MULTIPLAYER_DIFFICULTIES = Object.freeze(["Easy", "Normal", "Hard", "Lunatic"]);
// Character IDs follow TH09's original character_labels table in TitleData.inc.
const TH09_MULTIPLAYER_GLYPHS = Object.freeze(["霊", "魔", "咲", "妖", "鈴", "チ", "リ", "ミ", "て", "幽", "文", "メ", "小", "映", "メ", "ル"]);
const TH09_MULTIPLAYER_LOADOUTS = Object.freeze(Array.from({ length: 16 }, (_, character) =>
  Object.freeze({ labelKey: `multiplayer.loadout.th09_${character}`, glyph: TH09_MULTIPLAYER_GLYPHS[character], character, shot: 0 })));
const STANDARD_MULTIPLAYER_PLAYER_COUNTS = Object.freeze([2, 3] as const);
const TOGGLE_TOUCH_FIRE = Object.freeze({ mode: "toggle", labelKey: "touch.tapToggle" } as const);
const CHARGE_TOUCH_FIRE = Object.freeze({
  mode: "held-key",
  labelKey: "touch.holdFireCharge",
  key: Object.freeze({ code: "KeyZ", key: "z", keyCode: 90 }),
} as const);

export const PRODUCT_GAMES = Object.freeze({
  // support.highRefreshRate describes currently implemented presentation for
  // Launcher UI. False keeps unfinished adapters honest; it does not waive
  // the required presentation-cadence acceptance gate.
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
    musicCapabilities: Object.freeze({ midi: true }),
    musicRuntime: Object.freeze({ localOggConfigureMode: "midi-sentinel" }),
    touchFire: TOGGLE_TOUCH_FIRE,
    support: Object.freeze({ highRefreshRate: true,
      sourceRepository: "https://github.com/YomotsuHisami/th06",
    }),
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
      titleKey: "game.title.th06mp",
      gameplay: "cooperative",
      playerCounts: STANDARD_MULTIPLAYER_PLAYER_COUNTS,
      difficulties: STANDARD_MULTIPLAYER_DIFFICULTIES,
      loadouts: TH06_MULTIPLAYER_LOADOUTS,
      peerTransportGlobal: "__th06PeerTransport",
      spectator: true,
      titleRoomEntry: false,
    }),
    features: Object.freeze({ thprac: true, languages: true, focusHitbox: true }),
  }),
  th07: Object.freeze({
    cardArtwork: "th07-card.webp",
    cardPresentation: Object.freeze({
      positionPercent: 58,
      artBrightness: 0.42,
      artSaturation: 0.62,
      glowBrightness: 0.8,
      glowSaturation: 0.88,
    }),
    number: "07",
    title: "東方妖々夢",
    subtitle: "Perfect Cherry Blossom",
    storage: Object.freeze({
      saveRoot: "/savesth07",
      scoreFile: "score.dat",
      configFiles: Object.freeze(["th07.cfg"]),
    }),
    runtime: "./runtime/th07/th07.html",
    musicCapabilities: Object.freeze({ midi: true }),
    musicRuntime: Object.freeze({ localOggConfigureMode: "midi-sentinel" }),
    touchFire: TOGGLE_TOUCH_FIRE,
    support: Object.freeze({ highRefreshRate: true,
      sourceRepository: "https://github.com/YomotsuHisami/th07",
    }),
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
      titleKey: "game.title.th07mp",
      gameplay: "cooperative",
      playerCounts: STANDARD_MULTIPLAYER_PLAYER_COUNTS,
      difficulties: TH07_MULTIPLAYER_DIFFICULTIES,
      loadouts: TH07_MULTIPLAYER_LOADOUTS,
      peerTransportGlobal: "__th07PeerTransport",
      spectator: true,
      titleRoomEntry: false,
    }),
    features: Object.freeze({ thprac: true, languages: true, focusHitbox: false }),
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
    runtime: "./runtime/th08/th08.html",
    musicCapabilities: Object.freeze({ midi: true }),
    musicRuntime: Object.freeze({ localOggConfigureMode: "midi-sentinel" }),
    touchFire: TOGGLE_TOUCH_FIRE,
    support: Object.freeze({ highRefreshRate: true,
      sourceRepository: "https://github.com/YomotsuHisami/th08",
      adaptationNotice: "early-test",
    }),
    runtimeFileLayout: "directory",
    requiredShared: Object.freeze(["/msgothic.ttc", "/unifont.otf"]),
    runtimeAssets: Object.freeze([
      "th08.html",
      "manifest.json",
      "shell.mjs",
      "directory-keyboard.mjs",
      "eagler-host.mjs",
      "practice.mjs",
      "practice-config.mjs",
      "practice-sections.mjs",
      "motion-replay.mjs",
      "th08-sdl.mjs",
      "th08-sdl.wasm",
      "resources.json",
      "fonts/blend.bin",
      "fonts/cp932.bin",
    ]),
    dataProvider: "retail-memory",
    package: Object.freeze({
      dataFileId: "game-data",
      dataTarget: "/th08.data",
      rawDataImport: Object.freeze({ fileNames: Object.freeze(["th08.dat"]) }),
      musicSourceDirectories: Object.freeze({ ogg: "bgm-ogg" }),
      musicMounts: Object.freeze({ ogg: "/bgm-ogg" }),
    }),
    replay: Object.freeze({ prefix: "th8" }),
    multiplayerRuntime: "./runtime/th08/multiplayer/th08.html",
    multiplayer: Object.freeze({
      titleKey: "game.title.th08mp",
      gameplay: "cooperative",
      inputTiming: Object.freeze({ rollbackLimit: 8, sendPredictionLimit: 8, measuredStartup: true }),
      playerCounts: STANDARD_MULTIPLAYER_PLAYER_COUNTS,
      difficulties: STANDARD_MULTIPLAYER_DIFFICULTIES,
      loadouts: TH08_MULTIPLAYER_LOADOUTS,
      peerTransportGlobal: "__th08PeerTransport",
      preflightWithoutRoom: true,
      spectator: true,
      titleRoomEntry: false,
    }),
    features: Object.freeze({ thprac: true, languages: true, focusHitbox: false }),
  }),
  th09: Object.freeze({
    cardArtwork: "th09-card.webp",
    number: "09",
    title: "東方花映塚",
    subtitle: "Phantasmagoria of Flower View",
    storage: Object.freeze({ saveRoot: "/savesth09", scoreFile: "score.dat", configFiles: Object.freeze(["th09.cfg"]) }),
    runtime: "./runtime/th09/th09.html",
    musicCapabilities: Object.freeze({ midi: false }),
    musicRuntime: Object.freeze({ localOggConfigureMode: "runtime-selection" }),
    touchFire: CHARGE_TOUCH_FIRE,
    support: Object.freeze({ highRefreshRate: false, sourceRepository: "https://github.com/YomotsuHisami/th09", adaptationNotice: "early-test" }),
    runtimeFileLayout: "directory",
    requiredShared: Object.freeze(["/msgothic.ttc", "/unifont.otf"]),
    runtimeAssets: Object.freeze([
      "th09.html", "manifest.json", "version.json", "shell.mjs", "managed.css", "keyboard.mjs",
      "directory-keyboard.mjs",
      "shared-netplay.mjs", "motion-replay.mjs", "th09.mjs", "th09.wasm",
      "fonts/blend.bin", "fonts/cp932.bin",
    ]),
    dataProvider: "retail-memory",
    package: Object.freeze({
      dataFileId: "game-data", dataTarget: "/th09.data",
      rawDataImport: Object.freeze({ fileNames: Object.freeze(["th09.dat"]) }),
      musicSourceDirectories: Object.freeze({ ogg: "music" }),
      musicMounts: Object.freeze({ ogg: "/music" }),
    }),
    replay: Object.freeze({ prefix: "th9" }),
    multiplayerRuntime: "./runtime/th09/multiplayer/th09.html",
    multiplayer: Object.freeze({
      titleKey: "game.title.th09mp",
      gameplay: "versus",
      inputTiming: Object.freeze({ rollbackLimit: 8, measuredStartup: true, manualDelayLimit: 9 }),
      playerCounts: Object.freeze([2] as const),
      difficulties: TH09_MULTIPLAYER_DIFFICULTIES,
      loadouts: TH09_MULTIPLAYER_LOADOUTS,
      peerTransportGlobal: "__th09PeerTransport",
      // TH09's two-player rollback session publishes confirmed inputs to
      // admitted spectators without reviving the deprecated lockstep path.
      spectator: true,
      titleRoomEntry: true,
    }),
    features: Object.freeze({ thprac: false, languages: true, focusHitbox: false }),
  }),
  th10: Object.freeze({
    cardArtwork: "th10-card.webp",
    number: "10",
    title: "東方風神録",
    subtitle: "Mountain of Faith",
    storage: Object.freeze({ saveRoot: "/savesth10", scoreFile: "scoreth10.dat", configFiles: Object.freeze(["th10.cfg"]),
      hintFiles: Object.freeze(["hint/hint_user.txt", "hint/hint_auto.txt"]),
    }),
    display: Object.freeze({ faithBar: true }),
    runtime: "./runtime/th10/th10.html",
    musicCapabilities: Object.freeze({ midi: false }),
    musicRuntime: Object.freeze({ localOggConfigureMode: "midi-sentinel" }),
    touchFire: TOGGLE_TOUCH_FIRE,
    support: Object.freeze({ highRefreshRate: true,
      sourceRepository: "https://github.com/YomotsuHisami/th10",
      adaptationNotice: "early-test",
    }),
    runtimeFileLayout: "directory",
    requiredShared: Object.freeze(["/msgothic.ttc", "/unifont.otf"]),
    runtimeAssets: Object.freeze([
      "th10.html",
      "manifest.json",
      "shell.mjs",
      "directory-keyboard.mjs",
      "eagler-host.mjs",
      "practice.mjs",
      "practice-config.mjs",
      "practice-sections.mjs",
      "motion-replay.mjs",
      "th10-sdl.mjs",
      "th10-sdl.wasm",
      "resources.json",
      "fonts/blend.bin",
      "fonts/codepages.bin",
    ]),
    dataProvider: "retail-memory",
    package: Object.freeze({
      dataFileId: "game-data", dataTarget: "/th10.data",
      musicSourceDirectories: Object.freeze({ ogg: "bgm-ogg" }),
      musicMounts: Object.freeze({ ogg: "/bgm-ogg" }),
    }),
    replay: Object.freeze({ prefix: "th10" }),
    multiplayerRuntime: "./runtime/th10/multiplayer/th10.html",
    multiplayer: Object.freeze({
      titleKey: "game.title.th10mp",
      gameplay: "cooperative",
      inputTiming: Object.freeze({ rollbackLimit: 12, measuredStartup: true }),
      playerCounts: STANDARD_MULTIPLAYER_PLAYER_COUNTS,
      difficulties: STANDARD_MULTIPLAYER_DIFFICULTIES,
      loadouts: TH10_MULTIPLAYER_LOADOUTS,
      peerTransportGlobal: "__th10PeerTransport",
      spectator: true,
      titleRoomEntry: false,
    }),
    features: Object.freeze({ thprac: true, languages: true, focusHitbox: false }),
  }),
  th11: Object.freeze({
    number: "11",
    title: "東方地霊殿",
    subtitle: "Subterranean Animism",
    cardArtwork: "th11-card.webp",
    storage: Object.freeze({
      saveRoot: "/savesth11",
      scoreFile: "scoreth11.dat",
      configFiles: Object.freeze(["th11.cfg"]),
    }),
    runtime: "./runtime/th11/th11.html",
    musicCapabilities: Object.freeze({ midi: false }),
    musicRuntime: Object.freeze({ localOggConfigureMode: "runtime-selection" }),
    touchFire: TOGGLE_TOUCH_FIRE,
    support: Object.freeze({ highRefreshRate: false,
      sourceRepository: "https://github.com/YomotsuHisami/th11",
      adaptationNotice: "early-test",
    }),
    runtimeFileLayout: "directory",
    // Original glyphs use baked tables; localization and native thprac use Unifont.
    requiredShared: Object.freeze(["/unifont.otf"]),
    runtimeAssets: Object.freeze([
      "th11.html",
      "manifest.json",
      "shell.mjs",
      "managed.css",
      "keyboard.mjs",
      "directory-keyboard.mjs",
      "eagler-host.mjs",
      "motion-replay.mjs",
      "th11-sdl.mjs",
      "th11-sdl.wasm",
      "resources.json",
      "fonts/font0.bin",
      "fonts/font1.bin",
      "fonts/font2.bin",
      "fonts/font3.bin",
      "fonts/cp932.bin",
      "fonts/blend4444.bin",
    ]),
    dataProvider: "retail-memory",
    package: Object.freeze({
      dataFileId: "game-data",
      dataTarget: "/th11.dat",
      rawDataImport: Object.freeze({ fileNames: Object.freeze(["th11.dat"]) }),
      musicSourceDirectories: Object.freeze({ ogg: "music" }),
      musicMounts: Object.freeze({ ogg: "/music" }),
    }),
    replay: Object.freeze({ prefix: "th11" }),
    features: Object.freeze({ thprac: true, languages: true, focusHitbox: false }),
  }),
  th15: Object.freeze({
    number: "15",
    title: "東方紺珠伝",
    subtitle: "Legacy of Lunatic Kingdom",
    cardArtwork: "th15-card.webp",
    storage: Object.freeze({
      saveRoot: "/savesth15",
      scoreFile: "scoreth15.dat",
      configFiles: Object.freeze(["th15.cfg"]),
    }),
    runtime: "./runtime/th15/th15.html",
    musicCapabilities: Object.freeze({ midi: false }),
    musicRuntime: Object.freeze({ localOggConfigureMode: "runtime-selection" }),
    touchFire: TOGGLE_TOUCH_FIRE,
    thpracExtraFunctionKeys: Object.freeze(["U"] as const),
    support: Object.freeze({ highRefreshRate: true,
      sourceRepository: "https://github.com/YomotsuHisami/th15",
      adaptationNotice: "early-test",
    }),
    runtimeFileLayout: "directory",
    // Purple THPrac and localization use the shared Unicode font.
    requiredShared: Object.freeze(["/unifont.otf"]),
    runtimeAssets: Object.freeze([
      "th15.html",
      "manifest.json",
      "shell.mjs",
      "managed.css",
      "keyboard.mjs",
      "directory-keyboard.mjs",
      "th15.mjs",
      "th15.wasm",
      "resources.json",
      "fonts/font0.bin",
      "fonts/font1.bin",
      "fonts/font2.bin",
      "fonts/font3.bin",
      "fonts/font4.bin",
      "fonts/font5.bin",
      "fonts/font6.bin",
      "fonts/font7.bin",
      "fonts/cp932.bin",
      "fonts/blend4444.bin",
    ]),
    dataProvider: "retail-memory",
    package: Object.freeze({
      dataFileId: "game-data",
      dataTarget: "/th15.dat",
      rawDataImport: Object.freeze({ fileNames: Object.freeze(["th15.dat"]) }),
      musicSourceDirectories: Object.freeze({ ogg: "music" }),
      musicMounts: Object.freeze({ ogg: "/music" }),
    }),
    replay: Object.freeze({ prefix: "th15" }),
    features: Object.freeze({ thprac: true, languages: true, focusHitbox: false }),
  }),
  th20: Object.freeze({
    testOnly: true,
    number: "20",
    title: "東方錦上京",
    subtitle: "Fossilized Wonders",
    storage: Object.freeze({
      saveRoot: "/savesth20",
      scoreFile: "scoreth20.dat",
      configFiles: Object.freeze(["th20.cfg"]),
    }),
    runtime: "./runtime/th20/th20.html",
    musicCapabilities: Object.freeze({ midi: false }),
    musicRuntime: Object.freeze({ localOggConfigureMode: "runtime-selection" }),
    touchFire: TOGGLE_TOUCH_FIRE,
    support: Object.freeze({ highRefreshRate: false,
      sourceRepository: "https://github.com/Goan114/touhou20",
      adaptationNotice: "early-test",
      credit: Object.freeze({ name: "ぃ尐懒猫ゞ", url: "https://space.bilibili.com/15669619" }),
    }),
    runtimeFileLayout: "directory",
    requiredShared: Object.freeze(["/msgothic.ttc", "/unifont.otf"]),
    runtimeAssets: Object.freeze([
      "th20.html",
      "manifest.json",
      "shell.mjs",
      "directory-keyboard.mjs",
      "eagler-host.mjs",
      "motion-replay.mjs",
      "th20-sdl.mjs",
      "th20-sdl.wasm",
      "resources.json",
    ]),
    dataProvider: "retail-memory",
    package: Object.freeze({
      dataFileId: "game-data",
      dataTarget: "/th20.data",
      // TH20's canonical BGM is the /bgm-ogg OGG set decoded by the Runtime;
      // retail thbgm.dat is no longer a shipped resource.
      musicSourceDirectories: Object.freeze({ ogg: "bgm-ogg" }),
      musicMounts: Object.freeze({ ogg: "/bgm-ogg" }),
      rawDataImport: Object.freeze({ fileNames: Object.freeze(["th20.dat"]) }),
    }),
    replay: Object.freeze({ prefix: "th20" }),
    features: Object.freeze({ thprac: false, languages: true, focusHitbox: false }),
  }),
});

export type GameId = keyof typeof PRODUCT_GAMES;
export type ProductGame = (typeof PRODUCT_GAMES)[GameId];
export type MultiplayerGameId = {
  [K in GameId]: (typeof PRODUCT_GAMES)[K] extends { readonly multiplayerRuntime: string } ? K : never;
}[GameId];
export type MultiplayerProductId = `${MultiplayerGameId}mp`;
export type ProductId = GameId | MultiplayerProductId;
export interface MultiplayerLoadoutConfig {
  labelKey: string;
  glyph: string;
  character: number;
  shot: number;
}
export interface MultiplayerProductConfig {
  titleKey: string;
  gameplay: "cooperative" | "versus";
  inputTiming?: Readonly<{ rollbackLimit: number; sendPredictionLimit?: number; measuredStartup?: boolean; manualDelayLimit?: number }>;
  playerCounts: readonly (2 | 3)[];
  difficulties: readonly string[];
  loadouts: readonly MultiplayerLoadoutConfig[];
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

// Default navigation policy belongs with the product registry, not Launcher
// flow code. Keep today's behavior explicit so adding another product never
// requires hunting for fallback game IDs in routing/lobby logic.
export const DEFAULT_PRODUCT_ID: ProductId = "th06";
export const DEFAULT_MULTIPLAYER_PRODUCT_ID: MultiplayerProductId = "th07mp";

export function isGameId(value: string): value is GameId {
  return Object.hasOwn(PRODUCT_GAMES, value);
}

export function productEnabledForBuild(productId: string, testBuild = false): boolean {
  if (!isProductId(productId)) return false;
  const game = PRODUCT_GAMES[gameIdForProduct(productId as ProductId)];
  if ("hidden" in game && game.hidden) return false;
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

const HOST_RUNTIME_FEATURES = new Set<ProductFeatureId>(HOST_RUNTIME_FEATURE_IDS);

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
      music: { midi: product.musicCapabilities.midi ? { files: [] } : { files: [], supported: false } },
      languageOptions: [{ id: "ja", title: "日本語(原版)", pack: null }],
    }])),
  };
}
