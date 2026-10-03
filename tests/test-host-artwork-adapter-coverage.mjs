/** Cross-language format-adapter coverage gate.
 * Product registration and retail artwork decoding are separate owners, but
 * every formal game must have an artwork adapter before Host assembly can be
 * considered complete. */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { PRODUCT_GAMES } from "../lib/contracts/product-catalog.mjs";
import { HOST_SITE_ARTWORK_FILES } from "../lib/frontend-manifest.mjs";

const project = resolve(fileURLToPath(new URL("..", import.meta.url)));
const python = process.env.EAGLER_PYTHON || process.env.PYTHON || "python";
const result = spawnSync(python, ["scripts/prepare-host-artwork.py", "--list-games"], {
  cwd: project,
  encoding: "utf8",
  windowsHide: true,
});
assert.equal(result.error, undefined, `cannot start configured Python interpreter: ${python}`);
assert.equal(result.status, 0, result.stderr || result.stdout);
const report = JSON.parse(result.stdout);
assert.ok(Array.isArray(report.games));
assert.deepEqual([...report.games].sort(), Object.keys(PRODUCT_GAMES).sort(),
  "Host artwork format-adapter registry must cover every formal Product Catalog game");
for (const [game, product] of Object.entries(PRODUCT_GAMES)) {
  assert.ok(Array.isArray(report.files?.[game]), `${game}: artwork adapter did not report its outputs`);
  if (product.cardArtwork) {
    assert.ok(report.files[game].includes(product.cardArtwork),
      `${game}: artwork adapter outputs must include Product Catalog cardArtwork ${product.cardArtwork}`);
  }
}
for (const artwork of HOST_SITE_ARTWORK_FILES) {
  assert.ok(report.files.th06.includes(artwork),
    `TH06 host artwork adapter must produce global site artwork ${artwork}`);
}

console.log(JSON.stringify({ hostArtworkAdapterCoverage: "PASS", games: report.games }));
