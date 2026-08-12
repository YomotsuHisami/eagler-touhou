import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve, sep } from "node:path";
import { createThcrapClient, downloadThcrapPack } from "../integrations/thcrap.mjs";

const args = new Map();
for (let index = 2; index < process.argv.length; index++) {
  const key = process.argv[index];
  if (!key.startsWith("--")) throw new Error(`unexpected argument: ${key}`);
  const value = process.argv[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`missing value for ${key}`);
  args.set(key.slice(2), value); index++;
}
const language = args.get("language") || "lang_en";
const games = (args.get("games") || "th06,th07").split(",").filter(Boolean);
const output = resolve(args.get("output") || `prepared/thcrap/${language}`);
const client = createThcrapClient({ repository: args.get("repository") });

for (const game of games) {
  const pack = await client.resolveLanguage(language, game);
  const downloaded = await downloadThcrapPack(pack, {
    onProgress: ({ completed, total, path }) => process.stderr.write(`\r${game} ${completed}/${total} ${path}                    `)
  });
  for (const resource of downloaded.resources) {
    const target = resolve(output, resource.path);
    if (target !== output && !target.startsWith(output + sep)) throw new Error(`unsafe output path: ${resource.path}`);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, resource.bytes);
  }
  const manifest = { ...pack, assets: pack.assets.map(({ url, ...asset }) => asset) };
  await mkdir(output, { recursive: true });
  await writeFile(resolve(output, `${game}.manifest.json`), `${JSON.stringify(manifest, null, 2)}\n`);
  process.stderr.write("\n");
}
console.log(output);
