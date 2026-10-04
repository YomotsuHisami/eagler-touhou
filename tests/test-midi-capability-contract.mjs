import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { PRODUCT_GAMES } from "../lib/contracts/product-catalog.mjs";
import { workspacePath } from "../lib/workspace-layout.mjs";

const midiGames = Object.entries(PRODUCT_GAMES)
  .filter(([, product]) => product.musicCapabilities.midi)
  .map(([game]) => game);

for (const game of midiGames) {
  const product = PRODUCT_GAMES[game];
  if (product.runtimeFileLayout === "directory") {
    const shell = await readFile(workspacePath(game, `${game}_web`, "sdl-runtime", "shell.mjs"), "utf8");
    assert.match(shell, /["']touhou-midi["']/,
      `${game}: MIDI-capable directory Runtime must deliver MIDI bytes through the shared touhou-midi transport`);
    assert.match(shell, /["']midi["']/,
      `${game}: MIDI-capable directory Runtime must accept the MIDI music mode`);
  } else {
    const shell = await readFile(workspacePath(game, "resources", "shell.html"), "utf8");
    const midiDevice = await readFile(workspacePath(game, "src", "midi", "MidiWeb.cpp"), "utf8");
    assert.match(shell, /["']midi["']/,
      `${game}: MIDI-capable preload Runtime must accept the MIDI music mode`);
    assert.match(midiDevice, /CustomEvent\(["']touhou-midi["']/,
      `${game}: MIDI-capable preload Runtime must deliver MIDI bytes through the shared touhou-midi transport`);
    assert.match(midiDevice, /SendShortMsg/);
    assert.match(midiDevice, /SendLongMsg/);
  }
}

const launcher = await readFile(new URL("../app/services/midi.client.ts", import.meta.url), "utf8");
assert.match(launcher, /addEventListener\(["']touhou-midi["']/,
  "Launcher must own the shared Runtime MIDI event transport");
assert.match(launcher, /synth\.send\(/,
  "Launcher MIDI transport must feed an audible synth device");

console.log(JSON.stringify({
  midiCapabilityContract: "PASS",
  games: midiGames,
  transport: "touhou-midi -> Launcher MidiSynth",
}));
