export const HOST_PROTOCOL = "eagler-touhou/1";

export const PRODUCT_GAMES = Object.freeze({
  th06: Object.freeze({
    number: "06",
    title: "東方紅魔郷",
    subtitle: "the Embodiment of Scarlet Devil",
    runtime: "./runtime/th06/th06.html",
    multiplayerRuntime: "./runtime/th06/multiplayer/th06.html",
    features: Object.freeze({ thprac: true }),
  }),
  th07: Object.freeze({
    number: "07",
    title: "東方妖々夢",
    subtitle: "Perfect Cherry Blossom",
    runtime: "./runtime/th07/th07.html",
    multiplayerRuntime: "./runtime/th07/multiplayer/th07.html",
    features: Object.freeze({ thprac: true }),
  }),
  th08: Object.freeze({
    number: "08",
    title: "東方永夜抄",
    subtitle: "Imperishable Night",
    runtime: "./runtime/th08/th08-modern.html",
    features: Object.freeze({ thprac: false }),
  }),
});

export function createLocalProductManifest() {
  return {
    protocol: HOST_PROTOCOL,
    shared: { resourceMode: "hosted" },
    games: Object.fromEntries(Object.entries(PRODUCT_GAMES).map(([game, product]) => [game, {
      ...product,
      music: { midi: { files: [] } },
      languageOptions: [{ id: "ja", title: "日本語(原版)", pack: null }],
    }])),
  };
}
