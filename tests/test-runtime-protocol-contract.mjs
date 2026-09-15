/** L0 static contract. Preconditions: three adapter Shell sources.
 * Mutation: none. Proves the shared command/event vocabulary remains present.
 * Does NOT prove message execution, browser lifecycle, payload semantics or gameplay. */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PRODUCT_GAMES } from "../lib/contracts/product-catalog.mjs";
import { RUNTIME_PROTOCOL_COMMANDS, RUNTIME_PROTOCOL_EVENTS } from "../lib/contracts/runtime-protocol.mjs";
import { workspacePath } from "../lib/workspace-layout.mjs";

const shells = {
  th06: workspacePath("th06", "resources", "shell.html"),
  th07: workspacePath("th07", "resources", "shell.html"),
};
const shellGames = Object.entries(PRODUCT_GAMES)
  .filter(([, product]) => product.runtimeFileLayout !== "directory")
  .map(([game]) => game);
assert.deepEqual(Object.keys(shells).sort(), shellGames.sort());
for (const [game, path] of Object.entries(shells)) {
  const source = await readFile(path, "utf8");
  for (const command of RUNTIME_PROTOCOL_COMMANDS) {
    assert.ok(source.includes(`case "${command}"`), `${game}: shared command missing: ${command}`);
  }
  for (const event of RUNTIME_PROTOCOL_EVENTS) {
    const present = source.includes(`emit("${event}"`) ||
      (event === "ready" && /event:\s*"ready"/.test(source));
    assert.ok(present, `${game}: shared event missing: ${event}`);
  }
}
console.log(`Runtime protocol L0: PASS (${RUNTIME_PROTOCOL_COMMANDS.length} commands, ${RUNTIME_PROTOCOL_EVENTS.length} events)`);
