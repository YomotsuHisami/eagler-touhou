/** L0 generated-HTML registration contract. Mutation: none. Proves every
 * declared game has exactly one directory entry with its correct
 * identity and catalog-owned artwork. Rendering remains a
 * browser concern. */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { parse } from "parse5";
import { resolveFrontendPackageSource } from "../lib/frontend-manifest.mjs";
import {
  PRODUCT_GAMES,
  PRODUCT_IDS,
  gameIdForProduct,
  isMultiplayerProductId,
} from "../lib/contracts/product-catalog.mjs";

const html = await readFile(resolveFrontendPackageSource("index.html"), "utf8");
const css = await readFile(resolveFrontendPackageSource("styles.css"), "utf8");
const launcherSource = await readFile(new URL("../src/launcher/app.mts", import.meta.url), "utf8");
const document = parse(html);
const cards = [];
const modes = [];
const siteCards = [];

function attribute(node, name) {
  return node.attrs?.find(item => item.name === name)?.value ?? null;
}
function walk(node) {
  if (attribute(node, "data-launch-mode")) modes.push(attribute(node, "data-launch-mode"));
  if (node.tagName === "a" && String(attribute(node, "class") || "").split(/\s+/).includes("game")) {
    if(attribute(node, 'data-directory')==='site'){
      siteCards.push(node);
      assert.equal(attribute(node,'data-game'),null,'Site entry must never be a product');
      assert.equal(attribute(node,'data-product'),null);
      for(const child of node.childNodes||[]) walk(child);
      return;
    }
    const game = attribute(node, "data-game");
    const product = attribute(node, "data-product") || game;
    const images = [];
    const collectImages = child => {
      if (child.tagName === "img") images.push(attribute(child, "src"));
      for (const nested of child.childNodes || []) collectImages(nested);
    };
    collectImages(node);
    cards.push({ game, product, images, style: attribute(node, "style") || "", rail: attribute(node.parentNode, "id") });
  }
  for (const child of node.childNodes || []) walk(child);
}
walk(document);
assert.equal(siteCards.length,1,'One site entry precedes the games');
assert.equal(siteCards[0].parentNode.childNodes.filter(node=>node.tagName==='a')[0],siteCards[0]);
assert.doesNotMatch(html, /id="cardFilterBar"/, "the removed category filter must not return");
assert.deepEqual(modes.sort(), ["multiplayer", "singleplayer"], "both product modes remain registered while their selector is temporarily hidden");
assert.doesNotMatch(html, /minimap-swatch|--swatch-|minimap-panel/, "retired color-sample navigation must not return");

assert.equal(new Set(cards.map(card => card.product)).size, cards.length,
  "Launcher product cards must have unique product identities");
assert.deepEqual(cards.map(card => card.game).sort(), Object.keys(PRODUCT_GAMES).sort(),
  "every game needs exactly one directory entry, shared by solo and multiplayer");

for (const card of cards) {
  const game = gameIdForProduct(card.product);
  assert.equal(card.rail, "singleplayerRail",
    `${card.product}: card must belong to the shared directory`);
  assert.ok(PRODUCT_GAMES[game], `${card.product}: card points at an unregistered game`);
  assert.equal(card.game, game, `${card.product}: card data-game must resolve to the catalog owner`);
  if (PRODUCT_GAMES[game].cardArtwork) {
    assert.ok(card.images.includes(`assets/${PRODUCT_GAMES[game].cardArtwork}`),
      `${card.product}: card must use catalog-owned artwork`);
  } else {
    assert.equal(card.images.length, 0,
      `${card.product}: a product with no readable artwork adapter must not reference a missing image`);
  }
  const presentation = PRODUCT_GAMES[game].cardPresentation;
  if (presentation) {
    for (const expected of [
      `--art-position:${presentation.positionPercent}%`,
      `--card-art-brightness:${presentation.artBrightness}`,
      `--card-art-saturation:${presentation.artSaturation}`,
      `--card-glow-brightness:${presentation.glowBrightness}`,
      `--card-glow-saturation:${presentation.glowSaturation}`,
    ]) assert.ok(card.style.includes(expected), `${card.product}: generated card lost presentation declaration ${expected}`);
  }
  if (isMultiplayerProductId(card.product)) {
    assert.notEqual(card.product, card.game, `${card.product}: Multiplayer card needs explicit data-product`);
  } else {
    assert.equal(card.product, card.game, `${card.product}: ordinary card must not masquerade as another product`);
  }
}

assert.doesNotMatch(css, /\.game-th\d+/i,
  "shared Launcher CSS must not encode per-title card presentation branches; declare them in Product Catalog instead");
assert.doesNotMatch(css, /assets\/th\d+-card\.webp/i,
  "shared Launcher CSS must not carry a title-specific card-image fallback; touch/card previews must use Product Catalog artwork");
assert.doesNotMatch(launcherSource, /\$\{state\.game\}-card\.webp/,
  "Launcher must not reconstruct card filenames from a title-number convention");
assert.ok(/PRODUCT_GAMES\[[^\]]*\]/.test(launcherSource) && launcherSource.includes("cardArtwork"),
  "touch preview ownership must consume the Product Catalog cardArtwork declaration");
assert.doesNotMatch(html, /id="gameNoticeRepo"[^>]+href="[^"]*th\d+/i,
  "static Launcher HTML must not seed the dynamic game-repository link with one title's repository");
assert.match(launcherSource, /gameNoticeRepo["']\)\.href\s*=\s*support\.sourceRepository/,
  "visible adaptation notices must resolve their repository from Product Catalog support metadata");

console.log(JSON.stringify({ productSurface: "PASS", products: PRODUCT_IDS }));
