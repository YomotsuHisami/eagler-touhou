import assert from "node:assert/strict";
import { strToU8, zipSync } from "fflate";
import { parsePackageZip } from "../package-zip.mjs";

const descriptor = {
  schema: "eagler-touhou/package/1",
  game: "th08",
  revision: "pkg-a",
  runtime: { type: "html", entry: "entry", playerProtocol: "eagler-touhou/player/1" },
  files: {
    entry: { source: "games/th08/runtime.html", target: "/runtime.html", revision: "html-a", bytes: 4 },
    data: { source: "games/th08/game.data", target: "/game.data", revision: "data-a", bytes: 999 },
    "ogg:x": { source: "ogg/x.ogg", target: "/bgm/x.ogg", revision: "ogg-a" },
  },
  base: { files: ["entry", "data"] },
  components: { ogg: { type: "ogg", files: ["ogg:x"] } },
};
const zip = zipSync({
  "package.json": strToU8(JSON.stringify(descriptor)),
  "games/th08/runtime.html": strToU8("html"),
  // data is deliberately absent and declared bytes deliberately do not match
  // anything: neither condition is an import completeness gate.
  "ogg/x.ogg": strToU8("ogg-bytes"),
  "notes/ignored.txt": strToU8("extra entries are ignored"),
}, { level: 0 });
const parsed = await parsePackageZip(new Blob([zip]));
assert.equal(parsed.descriptor.game, "th08");
assert.deepEqual([...parsed.files.keys()], ["entry", "ogg:x"]);
assert.equal(await parsed.files.get("entry").blob.text(), "html");
assert.equal(parsed.files.has("data"), false, "missing declared files must remain absent instead of rejecting the ZIP");
console.log("Package ZIP contract: PASS");
