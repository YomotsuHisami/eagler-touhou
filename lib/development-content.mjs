import { PRODUCT_CONTENT } from "./content-definition.mjs";
import { projectRelativeWorkspaceDirectory, projectRelativeWorkspacePath } from "./workspace-layout.mjs";

const ws = projectRelativeWorkspacePath;
const wsDir = projectRelativeWorkspaceDirectory;

export const DEVELOPMENT_CONTENT = Object.freeze({
  shared: Object.freeze({
    vanillaFont: ws("th06", "assets", "msgothic.ttc"),
    unicodeFont: ws("dependencies", "unifont-15.1.05", "unifont-15.1.05.otf"),
  }),
  games: Object.freeze({
    th06: Object.freeze({
      runtime: `${ws("th06", "build-web-eagler-thprac-test", "th06.html")}?hosted=1&v=audio-music-modes-1`,
      multiplayerRuntime: `${ws("th06", "build-web-netplay-th06", "th06.html")}?hosted=1&v=th06-netplay-local-2`,
      data: Object.freeze({
        source: ws("th06", "build-web-eagler-thprac-test", "th06.data"),
        runtimeScript: ws("th06", "build-web-eagler-thprac-test", "th06.js"),
      }),
      music: Object.freeze({
        wav: Object.freeze({
          base: wsDir("th06", "assets", "bgm"),
          ...PRODUCT_CONTENT.th06.music.wav,
        }),
        ogg: Object.freeze({
          base: wsDir("th06", "assets-ogg", "bgm"),
          ...PRODUCT_CONTENT.th06.music.ogg,
        }),
      }),
    }),
    th07: Object.freeze({
      runtime: `${ws("th07", "build-web-eagler-thprac", "th07.html")}?hosted=1&v=audio-music-modes-1`,
      multiplayerRuntime: `${ws("th07", "build-web-th07-netplay", "th07.html")}?hosted=1&v=th07-netplay-local-2`,
      data: Object.freeze({
        source: ws("th07", "build-web-eagler-thprac", "th07.data"),
        runtimeScript: ws("th07", "build-web-eagler-thprac", "th07.js"),
      }),
      music: Object.freeze({
        wav: Object.freeze({ base: wsDir("th07", "assets"), ...PRODUCT_CONTENT.th07.music.wav }),
        ogg: Object.freeze({
          base: wsDir("th07", "assets-ogg", "bgm-ogg"),
          ...PRODUCT_CONTENT.th07.music.ogg,
        }),
      }),
    }),
    th08: Object.freeze({
      runtime: `${ws("th08", "build-eagler", "th08-modern.html")}?hosted=1`,
      data: Object.freeze({
        identity: Object.freeze({
          bytes: 46838025,
          sha256: "9d7edf43b8ddd347cbb641836f6b5050745dd936f688daebbf9382ca557043bb",
          layout: PRODUCT_CONTENT.th08.dataLayout,
        }),
      }),
      music: Object.freeze({
        ogg: Object.freeze({
          base: wsDir("th08", "assets-ogg", "bgm-ogg"),
          ...PRODUCT_CONTENT.th08.music.ogg,
        }),
      }),
    }),
    th10: Object.freeze({
      runtime: `${ws("th10", "build-eagler", "th10.html")}?hosted=1`,
      data: Object.freeze({
        source: ws("th10", "assets-ogg", "th10.data"),
        layout: PRODUCT_CONTENT.th10.dataLayout,
      }),
      music: Object.freeze({
        ogg: Object.freeze({
          base: wsDir("th10", "assets-ogg", "bgm-ogg"),
          ...PRODUCT_CONTENT.th10.music.ogg,
        }),
      }),
    }),
  }),
});
