/** Cross-repository semantic input contract for Launcher-owned controls.
 * Existing titles may keep different native bitmasks/state machines, but the
 * shared Restart control depends on one stable behavior: R restarts the current
 * run while the pause UI owns gameplay input. */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PRODUCT_GAMES } from "../lib/contracts/product-catalog.mjs";
import { workspacePath } from "../lib/workspace-layout.mjs";

const coveredGames = new Set();

const th06Ascii = await readFile(workspacePath("th06", "src", "AsciiManager.cpp"), "utf8");
assert.match(th06Ascii, /WAS_PRESSED\(TH_BUTTON_R\)[\s\S]{0,800}GAME_MENU_PAUSE_SELECTED_RESTART/,
  "th06: R must select the Pause restart action");
coveredGames.add("th06");

const th07Controller = await readFile(workspacePath("th07", "src", "Controller.cpp"), "utf8");
const th07Ascii = await readFile(workspacePath("th07", "src", "AsciiManager.cpp"), "utf8");
assert.match(th07Controller, /SDL_SCANCODE_R\s*,\s*TH_BUTTON_RESET/,
  "th07: R must map to the native Reset input bit");
assert.match(th07Ascii, /WAS_PRESSED_RAW\(TH_BUTTON_RESET\)/,
  "th07: Pause must consume the Reset input bit");
coveredGames.add("th07");

const th08Input = await readFile(workspacePath("th08", "th08_web", "cpp", "game", "InputController.cpp"), "utf8");
const th08Pause = await readFile(workspacePath("th08", "th08_web", "cpp", "game", "UiMenus.cpp"), "utf8");
assert.match(th08Input, /\{19\s*,\s*82\s*,\s*Reset\}/,
  "th08: R must map to the native Reset input bit");
assert.match(th08Pause, /restart\s*=\s*16384/,
  "th08: Pause restart must own the Reset input bit");
coveredGames.add("th08");

// TH09's in-game pause menu owns the retry action through its own input frame.
const th09Menu = await readFile(workspacePath("th09", "th09_web", "cpp", "game", "InGameMenu.cpp"), "utf8");
assert.match(th09Menu, /menu_action\(InGameAction::retry\)/,
  "th09: Pause must expose the retry (restart run) action");
coveredGames.add("th09");

const th10Input = await readFile(workspacePath("th10", "th10_web", "cpp", "game", "InputDevices.cpp"), "utf8");
const th10Pause = await readFile(workspacePath("th10", "th10_web", "cpp", "game", "ResultsPause.cpp"), "utf8");
assert.match(th10Input, /\{0x52\s*,\s*0x4000\}/i,
  "th10: R must map to the native restart input bit");
assert.match(th10Pause, /pressed\s*&\s*0x4000/,
  "th10: Pause must consume the restart input bit");
coveredGames.add("th10");

// TH20 recovers the original VK table: R (0x52) sets 0x200000, and the pause
// menu consumes that bit to confirm the retry action.
const th20Input = await readFile(workspacePath("th20", "source_reconstruction", "input", "input_state.cpp"), "utf8");
const th20Pause = await readFile(workspacePath("th20", "source_reconstruction", "pause_system", "menu.cpp"), "utf8");
assert.match(th20Input, /key\(0x52\s*,\s*0x200000\)/,
  "th20: R must map to the native restart input bit");
assert.match(th20Pause, /e\.pressed\(0x200000\)[\s\S]{0,80}confirm_retry/,
  "th20: Pause restart must consume the restart input bit");
coveredGames.add("th20");

// TH11 recovers the original VK table: R (0x52/82) sets 0x200000, and the
// pause menu consumes that bit to select the retry action.
const th11Input = await readFile(workspacePath("th11", "th11_web", "cpp", "game", "GameInput.cpp"), "utf8");
const th11Pause = await readFile(workspacePath("th11", "th11_web", "cpp", "game", "PauseMenu.cpp"), "utf8");
assert.match(th11Input, /\{82\s*,\s*0x200000\}/,
  "th11: R must map to the native restart input bit");
assert.match(th11Pause, /pressed\s*&\s*0x200000[\s\S]{0,80}cursor\.select\(3\)/,
  "th11: Pause restart must consume the restart input bit");
coveredGames.add("th11");

assert.deepEqual([...coveredGames].sort(), Object.keys(PRODUCT_GAMES).sort(),
  "required restart-action verification must be updated when a formal game adapter is registered");
console.log(`Required gameplay actions: PASS (R -> pause restart for ${Object.keys(PRODUCT_GAMES).map(game => game.toUpperCase()).join("/")})`);
