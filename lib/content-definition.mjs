import { PRODUCT_GAMES } from "./contracts/product-catalog.mjs";
import { TH11_MUSIC_FILES } from "./th11-content-layout.mjs";
import { TH20_MUSIC_FILES } from "./th20-content-layout.mjs";

const numbered = (prefix, values, extension) => Object.freeze(values.map(value => `${prefix}_${value}.${extension}`));
const TH06_ARCHIVES = Object.freeze([
  "紅魔郷CM.DAT", "紅魔郷ED.DAT", "紅魔郷IN.DAT",
  "紅魔郷MD.DAT", "紅魔郷ST.DAT", "紅魔郷TL.DAT",
]);

// Product content shape only. This file declares names and Runtime mounts, but
// never points at a workstation build, asset directory, or generated identity.
export const PRODUCT_CONTENT = Object.freeze({
  th06: Object.freeze({
    original: Object.freeze({
      files: TH06_ARCHIVES,
      oggSourceFiles: Object.freeze(Array.from({ length: 17 }, (_, index) => `bgm/th06_${String(index + 1).padStart(2, "0")}.wav`)),
    }),
    music: Object.freeze({
      wav: Object.freeze({ mount: PRODUCT_GAMES.th06.package.musicMounts.wav, files: numbered("th06", Array.from({ length: 17 }, (_, index) => String(index + 1).padStart(2, "0")), "wav") }),
      ogg: Object.freeze({ mount: PRODUCT_GAMES.th06.package.musicMounts.ogg, files: numbered("th06", Array.from({ length: 17 }, (_, index) => String(index + 1).padStart(2, "0")), "ogg") }),
    }),
    hostPreparation: Object.freeze({
      artwork: Object.freeze({
        kind: "pbg3-title-plus-pe-icon",
        card: Object.freeze({ archive: "紅魔郷TL.DAT", entry: "title00.jpg" }),
        icon: Object.freeze({ executableCandidates: Object.freeze(["th06.exe", "東方紅魔郷.exe", "紅魔郷.exe"]) }),
      }),
      languagePack: Object.freeze({
        kind: "thcrap-runtime-compiler",
        inputMode: "archives",
        developmentEnv: "EAGLER_TH06_ARCHIVES",
        developmentFiles: Object.freeze(["紅魔郷ST.DAT", "紅魔郷ED.DAT"]),
      }),
      ogg: Object.freeze({ kind: "verified-converter", outputDirectory: "bgm" }),
      dataAssets: Object.freeze({
        kind: "legacy-preload-with-focus-hitbox",
        focusHitbox: Object.freeze({
          sourceGame: "th07",
          extractor: "extract-th07-texture",
          archive: "th07.dat",
          anm: "etama.anm",
          texture: "data/etama/etama2.png",
          output: "eagler-hitbox.png",
        }),
      }),
    }),
  }),
  th07: Object.freeze({
    original: Object.freeze({
      files: Object.freeze(["th07.dat"]),
      oggSourceFiles: Object.freeze(["thbgm.dat"]),
    }),
    music: Object.freeze({
      wav: Object.freeze({ mount: PRODUCT_GAMES.th07.package.musicMounts.wav, files: Object.freeze(["thbgm.dat"]) }),
      ogg: Object.freeze({ mount: PRODUCT_GAMES.th07.package.musicMounts.ogg, files: numbered("th07", ["01", "02", "03", "04", "05", "06", "07", "08", "09", "10", "11", "12", "13", "13b", "14", "15", "16", "17", "18", "19"], "ogg") }),
    }),
    hostPreparation: Object.freeze({
      artwork: Object.freeze({
        kind: "pbg4-title",
        card: Object.freeze({ archive: "th07.dat", entry: "title00.jpg" }),
      }),
      languagePack: Object.freeze({
        kind: "thcrap-runtime-compiler",
        inputMode: "archive",
        archive: "th07.dat",
        developmentEnv: "EAGLER_TH07_ARCHIVES",
        developmentFiles: Object.freeze(["th07.dat"]),
      }),
      ogg: Object.freeze({ kind: "verified-converter", outputDirectory: "bgm-ogg" }),
    }),
  }),
  th08: Object.freeze({
    original: Object.freeze({
      files: Object.freeze(["th08.dat"]),
      oggSourceFiles: Object.freeze(["thbgm.dat"]),
    }),
    dataLayout: "sha256-8df4f18fe2e70e5b505906276dfb7b0f8aee5854eb931fbca5c1b9dbf065d566",
    music: Object.freeze({
      ogg: Object.freeze({ mount: PRODUCT_GAMES.th08.package.musicMounts.ogg, files: numbered("th08", ["01", "00", "03", "04", "05", "06", "07", "08", "09", "10", "11", "12", "13", "14", "13b", "15", "16", "17", "18", "19", "20"], "ogg") }),
    }),
    hostPreparation: Object.freeze({
      artwork: Object.freeze({
        kind: "pbgz-title",
        card: Object.freeze({ archive: "th08.dat", entry: "title/title00.png" }),
      }),
      languagePack: Object.freeze({
        kind: "thcrap-runtime-compiler",
        inputMode: "archive",
        archive: "th08.dat",
        developmentEnv: "EAGLER_TH08_ARCHIVES",
        developmentFiles: Object.freeze(["th08.dat"]),
      }),
      ogg: Object.freeze({ kind: "verified-converter", outputDirectory: "bgm-ogg" }),
      dataAssets: Object.freeze({ kind: "original-file", source: "th08.dat" }),
    }),
  }),
  th09: Object.freeze({
    original: Object.freeze({
      files: Object.freeze(["th09.dat"]),
      oggSourceFiles: Object.freeze(["thbgm.dat"]),
      preparedAlternative: Object.freeze({
        directory: "assets-ogg",
        markerFiles: Object.freeze(["th09.data", "music/th09_00.ogg"]),
      }),
    }),
    // Identity of the Runtime mount contract, not of a particular retail copy.
    dataLayout: "sha256-cfa37d5389bd27973dcbc55f86a90c55185f3428bcde6b9fd9501d758cb334fe",
    music: Object.freeze({
      ogg: Object.freeze({ mount: PRODUCT_GAMES.th09.package.musicMounts.ogg, files: Object.freeze([
        "th09_00.ogg", "th09_00b.ogg", "th09_00c.ogg", "th09_01.ogg", "th09_02.ogg",
        "th09_05.ogg", "th09_07.ogg", "th07_09.ogg", "th07_10_b.ogg", "th09_08_2.ogg",
        "th09_09.ogg", "th08_12.ogg", "th09_10.ogg", "th09_11.ogg", "th09_12.ogg",
        "th09_13.ogg", "th09_14.ogg", "th09_15.ogg", "th09_17.ogg",
      ]) }),
    }),
    hostPreparation: Object.freeze({
      artwork: Object.freeze({
        kind: "pbgz-title",
        card: Object.freeze({ archive: "th09.dat", entry: "title00.png" }),
      }),
      languagePack: Object.freeze({
        kind: "thcrap-runtime-compiler",
        inputMode: "archive",
        archive: "th09.dat",
        developmentEnv: "EAGLER_TH09_ARCHIVES",
        developmentFiles: Object.freeze(["th09.dat"]),
      }),
      ogg: Object.freeze({ kind: "prepared-content" }),
      preparedContent: Object.freeze({
        directory: "assets-ogg",
        markerFiles: Object.freeze(["th09.data", "music/th09_00.ogg"]),
        script: "scripts/prepare-th09-content.mjs",
      }),
      dataAssets: Object.freeze({ kind: "prepared-content" }),
    }),
  }),
  th10: Object.freeze({
    original: Object.freeze({
      files: Object.freeze(["th10.dat"]),
      oggSourceFiles: Object.freeze(["thbgm.dat"]),
      preparedAlternative: Object.freeze({
        directory: "assets-ogg",
        markerFiles: Object.freeze(["th10.data", "bgm-ogg/th10_00.ogg"]),
      }),
    }),
    dataLayout: "sha256-6b25b2ce0bf32d56880d32b4a0d26541eae670ee31e4de7126fcfd4d95f446a7",
    music: Object.freeze({
      ogg: Object.freeze({
        mount: PRODUCT_GAMES.th10.package.musicMounts.ogg,
        // thbgm.dat's retail order starts with title (02), then stage 1 (00).
        // Keep that order in the package so the Runtime's first available
        // tracks are audible while retaining the original th10_XX names.
        files: numbered("th10", ["02", "00", "01", ...Array.from({ length: 10 }, (_, index) => String(index + 3).padStart(2, "0")), "15", "16", "13", "14", "17"], "ogg"),
      }),
    }),
    hostPreparation: Object.freeze({
      artwork: Object.freeze({
        kind: "thtk-anm-title",
        card: Object.freeze({ archive: "th10.dat", anm: "title.anm", textures: Object.freeze(["title/title00a.png", "title/title00b.png"]) }),
      }),
      preparedContent: Object.freeze({
        directory: "assets-ogg",
        markerFiles: Object.freeze(["th10.data", "bgm-ogg/th10_00.ogg"]),
        script: "scripts/prepare-th10-content.mjs",
      }),
      ogg: Object.freeze({ kind: "prepared-content" }),
      dataAssets: Object.freeze({ kind: "prepared-content" }),
      languagePack: Object.freeze({
        kind: "thcrap-runtime-compiler",
        inputMode: "archive",
        archive: "th10.dat",
        developmentEnv: "EAGLER_TH10_ARCHIVES",
        developmentFiles: Object.freeze(["th10.dat"]),
      }),
    }),
  }),
  th11: Object.freeze({
    original: Object.freeze({
      files: Object.freeze(["th11.dat"]),
      oggSourceFiles: Object.freeze(["thbgm.dat"]),
      preparedAlternative: Object.freeze({
        directory: "assets-ogg",
        markerFiles: Object.freeze(["th11.data", "music/th11_00.ogg"]),
      }),
    }),
    // Runtime mount-contract identity. TH11's managed mount is just the retail
    // archive; baked font tables travel separately through resources.json.
    //   sha256(JSON.stringify({files:[{filename:"/th11.dat"}]}))
    dataLayout: "sha256-32e5ff68ae9150506c268f5fd2210bfa42ef2e14a581ddf44dc1ae92e8da5c7a",
    music: Object.freeze({
      ogg: Object.freeze({
        mount: PRODUCT_GAMES.th11.package.musicMounts.ogg,
        files: TH11_MUSIC_FILES,
      }),
    }),
    hostPreparation: Object.freeze({
      artwork: Object.freeze({ kind: "retail-memory-title-no-reader" }),
      preparedContent: Object.freeze({
        directory: "assets-ogg",
        markerFiles: Object.freeze(["th11.data", "music/th11_00.ogg"]),
        script: "scripts/prepare-th11-content.mjs",
      }),
      ogg: Object.freeze({ kind: "prepared-content" }),
      dataAssets: Object.freeze({ kind: "prepared-content" }),
      languagePack: Object.freeze({
        kind: "thcrap-runtime-compiler",
        inputMode: "archive",
        archive: "th11.dat",
        developmentEnv: "EAGLER_TH11_ARCHIVES",
        developmentFiles: Object.freeze(["th11.dat"]),
      }),
    }),
  }),
  th20: Object.freeze({
    original: Object.freeze({
      files: Object.freeze(["th20.dat"]),
      oggSourceFiles: Object.freeze(["thbgm.dat"]),
      preparedAlternative: Object.freeze({
        directory: "assets-ogg",
        markerFiles: Object.freeze(["th20.data", "bgm-ogg/th20_01.ogg"]),
      }),
    }),
    // Free-form Runtime mount-contract identity, assigned by the port author's
    // convention (package-launcher.mjs / package-architecture.mjs):
    //   "sha256-" + sha256(JSON.stringify({ files: [{ filename }, ...] }))
    // over the TH20 managed mounts. TH20's BGM is now the /bgm-ogg OGG set, so
    // the retained managed data mount is just the primary archive.
    //   sha256(JSON.stringify({files:[{filename:"/game/th20.dat"}]}))
    dataLayout: "sha256-60a03469dc592e88413c1d9a4d8fd90b109a486b8edac3c837002238e9a73800",
    music: Object.freeze({
      ogg: Object.freeze({
        mount: PRODUCT_GAMES.th20.package.musicMounts.ogg,
        // thbgm.fmt archive order; the final track is a TH128 borrow that keeps
        // its original th128_08 filename, and th20_13 precedes th20_12.
        files: TH20_MUSIC_FILES,
      }),
    }),
    hostPreparation: Object.freeze({
      artwork: Object.freeze({
        kind: "retail-memory-title-no-reader",
      }),
      preparedContent: Object.freeze({
        directory: "assets-ogg",
        markerFiles: Object.freeze(["th20.data", "bgm-ogg/th20_01.ogg"]),
        script: "scripts/prepare-th20-content.mjs",
      }),
      ogg: Object.freeze({ kind: "prepared-content" }),
      dataAssets: Object.freeze({ kind: "prepared-content" }),
    }),
  }),
});
