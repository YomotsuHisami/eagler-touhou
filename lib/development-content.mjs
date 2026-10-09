import { PRODUCT_CONTENT } from "./content-definition.mjs";
import { projectRelativeWorkspaceDirectory, projectRelativeWorkspacePath } from "./workspace-layout.mjs";
import { relative, resolve } from "node:path";
import { existsSync } from "node:fs";

const ws = projectRelativeWorkspacePath;
const wsDir = projectRelativeWorkspaceDirectory;
const project = resolve(import.meta.dirname, "..");
const projectRelativePath = path => {
  const value = relative(project, resolve(path)).replaceAll("\\", "/");
  return value.startsWith(".") ? value : `./${value}`;
};
const th08ContentRoot = process.env.EAGLER_TH08_CONTENT_DIR?.trim()
  ? resolve(process.env.EAGLER_TH08_CONTENT_DIR.trim())
  : null;
const th08DataFile = process.env.EAGLER_TH08_DATA_FILE?.trim()
  ? resolve(process.env.EAGLER_TH08_DATA_FILE.trim())
  : null;
const th10ContentRoot = process.env.EAGLER_TH10_CONTENT_DIR?.trim()
  ? resolve(process.env.EAGLER_TH10_CONTENT_DIR.trim())
  : null;
const th11ContentRoot = process.env.EAGLER_TH11_CONTENT_DIR?.trim()
  ? resolve(process.env.EAGLER_TH11_CONTENT_DIR.trim())
  : null;
const th09ContentRoot = process.env.EAGLER_TH09_CONTENT_DIR?.trim()
  ? resolve(process.env.EAGLER_TH09_CONTENT_DIR.trim())
  : null;
const th15ContentRoot = process.env.EAGLER_TH15_CONTENT_DIR?.trim()
  ? resolve(process.env.EAGLER_TH15_CONTENT_DIR.trim())
  : null;
const th20ContentRoot = process.env.EAGLER_TH20_CONTENT_DIR?.trim()
  ? resolve(process.env.EAGLER_TH20_CONTENT_DIR.trim())
  : null;
const th06ContentRoot = process.env.EAGLER_TH06_CONTENT_DIR?.trim()
  ? resolve(process.env.EAGLER_TH06_CONTENT_DIR.trim())
  : null;
const th07ContentRoot = process.env.EAGLER_TH07_CONTENT_DIR?.trim()
  ? resolve(process.env.EAGLER_TH07_CONTENT_DIR.trim())
  : null;
function availableMusic(declarations, contentRoot) {
  return Object.freeze(Object.fromEntries(Object.entries(declarations).filter(([, entry]) =>
    contentRoot || entry.files.every(name => existsSync(resolve(project, entry.base, name))))));
}

export const DEVELOPMENT_CONTENT = Object.freeze({
  shared: Object.freeze({
    vanillaFont: process.env.EAGLER_DEVELOPMENT_VANILLA_FONT
      ? projectRelativePath(process.env.EAGLER_DEVELOPMENT_VANILLA_FONT)
      : ws("th06", "assets", "msgothic.ttc"),
    unicodeFont: process.env.EAGLER_DEVELOPMENT_UNICODE_FONT
      ? projectRelativePath(process.env.EAGLER_DEVELOPMENT_UNICODE_FONT)
      : ws("dependencies", "unifont-15.1.05", "unifont-15.1.05.otf"),
  }),
  games: Object.freeze({
    th06: Object.freeze({
      runtime: `${ws("th06", "build-web-eagler-thprac-test", "th06.html")}?hosted=1&v=audio-music-modes-1`,
      multiplayerRuntime: `${ws("th06", "build-web-netplay-th06", "th06.html")}?hosted=1&v=th06-netplay-local-2`,
      data: Object.freeze({
        source: th06ContentRoot ? projectRelativePath(resolve(th06ContentRoot, "th06.data")) : ws("th06", "build-web-eagler-thprac-test", "th06.data"),
        runtimeScript: th06ContentRoot ? projectRelativePath(resolve(th06ContentRoot, "th06.js")) : ws("th06", "build-web-eagler-thprac-test", "th06.js"),
      }),
      music: availableMusic({
        wav: Object.freeze({
          base: th06ContentRoot ? `${projectRelativePath(resolve(th06ContentRoot, "bgm"))}/` : wsDir("th06", "assets", "bgm"),
          ...PRODUCT_CONTENT.th06.music.wav,
        }),
        ogg: Object.freeze({
          base: th06ContentRoot ? `${projectRelativePath(resolve(th06ContentRoot, "bgm-ogg"))}/` : wsDir("th06", "assets-ogg", "bgm"),
          ...PRODUCT_CONTENT.th06.music.ogg,
        }),
      }, th06ContentRoot),
    }),
    th07: Object.freeze({
      runtime: `${ws("th07", "build-web-eagler-thprac", "th07.html")}?hosted=1&v=audio-music-modes-1`,
      multiplayerRuntime: `${ws("th07", "build-web-th07-netplay", "th07.html")}?hosted=1&v=th07-netplay-local-2`,
      data: Object.freeze({
        source: th07ContentRoot ? projectRelativePath(resolve(th07ContentRoot, "th07.data")) : ws("th07", "build-web-eagler-thprac", "th07.data"),
        runtimeScript: th07ContentRoot ? projectRelativePath(resolve(th07ContentRoot, "th07.js")) : ws("th07", "build-web-eagler-thprac", "th07.js"),
      }),
      music: availableMusic({
        wav: Object.freeze({ base: th07ContentRoot ? `${projectRelativePath(th07ContentRoot)}/` : wsDir("th07", "assets"), ...PRODUCT_CONTENT.th07.music.wav }),
        ogg: Object.freeze({
          base: th07ContentRoot ? `${projectRelativePath(resolve(th07ContentRoot, "bgm-ogg"))}/` : wsDir("th07", "assets-ogg", "bgm-ogg"),
          ...PRODUCT_CONTENT.th07.music.ogg,
        }),
      }, th07ContentRoot),
    }),
    th08: Object.freeze({
      runtime: `${ws("th08", "build-eagler", "th08.html")}?hosted=1`,
      data: Object.freeze(th08DataFile ? {
        source: projectRelativePath(th08DataFile),
        layout: PRODUCT_CONTENT.th08.dataLayout,
      } : {
        identity: Object.freeze({
          bytes: 46838025,
          sha256: "9d7edf43b8ddd347cbb641836f6b5050745dd936f688daebbf9382ca557043bb",
          layout: PRODUCT_CONTENT.th08.dataLayout,
        }),
      }),
      music: Object.freeze(th08ContentRoot ? {
        ogg: Object.freeze({
          base: `${projectRelativePath(resolve(th08ContentRoot, "bgm-ogg"))}/`,
          ...PRODUCT_CONTENT.th08.music.ogg,
        }),
      } : {}),
    }),
    th09: Object.freeze({
      runtime: `${ws("th09", "th09_web", "build-eagler", "th09.html")}?hosted=1`,
      multiplayerRuntime: `${ws("th09", "th09_web", "build-eagler-multiplayer", "th09.html")}?hosted=1`,
      data: Object.freeze({
        source: th09ContentRoot
          ? projectRelativePath(resolve(th09ContentRoot, "th09.data"))
          : ws("th09", "[th09] 东方花映塚 (日文版)", "th09.dat"),
        layout: PRODUCT_CONTENT.th09.dataLayout,
      }),
      music: Object.freeze(th09ContentRoot ? {
        ogg: Object.freeze({
          base: `${projectRelativePath(resolve(th09ContentRoot, "music"))}/`,
          ...PRODUCT_CONTENT.th09.music.ogg,
        }),
      } : {}),
    }),
    th10: Object.freeze({
      runtime: `${ws("th10", "build-eagler", "th10.html")}?hosted=1`,
      data: Object.freeze(th10ContentRoot ? {
        source: projectRelativePath(resolve(th10ContentRoot, "th10.data")),
        layout: PRODUCT_CONTENT.th10.dataLayout,
      } : {
        identity: Object.freeze({
          bytes: 27696219,
          sha256: "1fb1d0ffe34115f563f5feb43755c0feee2315b0ac2b32e2f9e84c81e9433bea",
          layout: PRODUCT_CONTENT.th10.dataLayout,
        }),
      }),
      music: Object.freeze(th10ContentRoot ? {
        ogg: Object.freeze({
          base: `${projectRelativePath(resolve(th10ContentRoot, "bgm-ogg"))}/`,
          ...PRODUCT_CONTENT.th10.music.ogg,
        }),
      } : {}),
    }),
    th11: Object.freeze({
      runtime: `${ws("th11", "build-eagler", "th11.html")}?hosted=1`,
      multiplayerRuntime: `${ws("th11mp", "build-eagler-multiplayer", "th11.html")}?hosted=1`,
      data: Object.freeze(th11ContentRoot ? {
        source: projectRelativePath(resolve(th11ContentRoot, "th11.data")),
        layout: PRODUCT_CONTENT.th11.dataLayout,
      } : {
        identity: Object.freeze({
          bytes: 26610794,
          sha256: "3cb521c5d420d8cbad6494d53bcdb048bcc396abf95c18fac68e38fd2d19f8e2",
          layout: PRODUCT_CONTENT.th11.dataLayout,
        }),
      }),
      // TH11's BGM is the prepared /music OGG set; without a content root the
      // Launcher has no host-owned music and relies on an imported Package.
      music: Object.freeze(th11ContentRoot ? {
        ogg: Object.freeze({
          base: `${projectRelativePath(resolve(th11ContentRoot, "music"))}/`,
          ...PRODUCT_CONTENT.th11.music.ogg,
        }),
      } : {}),
    }),
    th15: Object.freeze({
      runtime: `${ws("th15", "build-eagler", "th15.html")}?hosted=1`,
      data: Object.freeze(th15ContentRoot ? {
        source: projectRelativePath(resolve(th15ContentRoot, "th15.data")),
        layout: PRODUCT_CONTENT.th15.dataLayout,
      } : {
        identity: Object.freeze({
          bytes: 77453661,
          sha256: "f3802e71db30f99b86d61b6e98b8325716c5cbae892547c563dded7837862ae7",
          layout: PRODUCT_CONTENT.th15.dataLayout,
        }),
      }),
      // TH15's BGM is the prepared /music OGG set; without a content root the
      // Launcher has no host-owned music and relies on an imported Package.
      music: Object.freeze(th15ContentRoot ? {
        ogg: Object.freeze({
          base: `${projectRelativePath(resolve(th15ContentRoot, "music"))}/`,
          ...PRODUCT_CONTENT.th15.music.ogg,
        }),
      } : {}),
    }),
    th20: Object.freeze({
      runtime: `${ws("th20", "build-eagler", "th20.html")}?hosted=1`,
      data: Object.freeze(th20ContentRoot ? {
        source: projectRelativePath(resolve(th20ContentRoot, "th20.data")),
        layout: PRODUCT_CONTENT.th20.dataLayout,
      } : {
        identity: Object.freeze({
          bytes: 150943726,
          sha256: "9db8d7c43fbacec95614163d4c3e1d254e82169f8550177ee849831130590494",
          layout: PRODUCT_CONTENT.th20.dataLayout,
        }),
      }),
      // TH20's BGM is the prepared /bgm-ogg set; without a content root the
      // Launcher has no host-owned music and relies on an imported Package.
      music: Object.freeze(th20ContentRoot ? {
        ogg: Object.freeze({
          base: `${projectRelativePath(resolve(th20ContentRoot, "bgm-ogg"))}/`,
          ...PRODUCT_CONTENT.th20.music.ogg,
        }),
      } : {}),
    }),
  }),
});
