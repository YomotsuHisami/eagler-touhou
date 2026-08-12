import { copyFile, mkdir } from "node:fs/promises";

await mkdir(new URL("../vendor/", import.meta.url), { recursive: true });
await copyFile(
  new URL("../node_modules/webaudio-tinysynth/webaudio-tinysynth.min.js", import.meta.url),
  new URL("../vendor/webaudio-tinysynth.min.js", import.meta.url),
);
await copyFile(
  new URL("../node_modules/webaudio-tinysynth/LICENSE", import.meta.url),
  new URL("../vendor/webaudio-tinysynth.LICENSE", import.meta.url),
);
await copyFile(
  new URL("../node_modules/fflate/umd/index.js", import.meta.url),
  new URL("../vendor/fflate.min.js", import.meta.url),
);
await copyFile(
  new URL("../node_modules/fflate/LICENSE", import.meta.url),
  new URL("../vendor/fflate.LICENSE", import.meta.url),
);
