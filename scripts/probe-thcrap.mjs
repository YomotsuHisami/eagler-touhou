import { createThcrapClient } from "../integrations/thcrap.mjs";

const client = createThcrapClient();
const languages = await client.discoverLanguages();
const selected = process.argv[2] || "lang_en";
const packs = await Promise.all(["th06", "th07"].map(game => client.resolveLanguage(selected, game)));
console.log(JSON.stringify({
  repository: client.repository,
  languages: languages.length,
  selected,
  games: Object.fromEntries(packs.map(pack => [pack.game, {
    assets: pack.assets.length,
    kinds: Object.fromEntries([...new Set(pack.assets.map(asset => asset.kind))].map(kind => [kind, pack.assets.filter(asset => asset.kind === kind).length]))
  }]))
}, null, 2));
