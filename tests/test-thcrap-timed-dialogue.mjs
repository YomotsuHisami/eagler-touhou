// Private original archives are explicit inputs, never checked into this repo.
// Compare every packaged story MSG against the original game's timecodes and
// control instructions, with extra coverage for dialogue without input waits.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {unzipSync} from 'fflate';
import {ThtkRunner} from '../server/thtk-runner.mjs';

const [game, archive, packRoot, toolRoot, temporaryRoot] = process.argv.slice(2);
assert.ok(['th10', 'th11'].includes(game) && archive && packRoot && toolRoot && temporaryRoot,
  'Usage: node tests/test-thcrap-timed-dialogue.mjs th10|th11 ORIGINAL_DAT PACK_DIRECTORY THTK_DIRECTORY TEMP_DIRECTORY');
const version = Number(game.slice(2)), textOp = version === 10 ? 16 : 17, waitOp = version === 10 ? 10 : 11;
const runner = new ThtkRunner({thdat:resolve(toolRoot, 'thdat.exe'), thmsg:resolve(toolRoot, 'thmsg.exe'), temporaryRoot});
function entries(bytes) {
  const count = bytes.readUInt32LE(0), result = [];
  for (let entry = 0; entry < count; entry++) {
    const commands = []; let offset = bytes.readUInt32LE(4 + entry * 8);
    assert.ok(offset >= 4 + count * 8 && offset < bytes.length);
    while (true) {
      assert.ok(offset + 4 <= bytes.length);
      const time = bytes.readUInt16LE(offset), op = bytes[offset + 2], size = bytes[offset + 3];
      assert.ok(offset + 4 + size <= bytes.length);
      commands.push({time, op, data:bytes.subarray(offset + 4, offset + 4 + size).toString('hex')});
      offset += 4 + size;
      if (!op && !time) break;
    }
    result.push(commands);
  }
  return result;
}
const originals = new Map(); let messages = 0, timedEntries = 0;
for (const language of ['lang_en', 'lang_zh-hans']) {
  const pack = unzipSync(await readFile(resolve(packRoot, 'language', language + '.zip')));
  for (const [path, data] of Object.entries(pack)) {
    const name = path.split('/').at(-1);
    if (!/^st\d\d_.*\.msg$/.test(name)) continue;
    if (!originals.has(name)) originals.set(name, entries(await runner.extractArchiveEntry(archive, name, version)));
    const original = originals.get(name), translated = entries(Buffer.from(data));
    assert.equal(translated.length, original.length, name + ': entry count');
    for (let id = 0; id < original.length; id++) {
      const label = `${game}/${language}/${name} entry ${id}`;
      // OP_DELETE 25 in MSG_TH11 is the sole allowed control-op removal.
      const controls = commands => commands.filter(c => c.op !== textOp && !(version === 11 && c.op === 25));
      assert.deepEqual(controls(translated[id]), controls(original[id]), label + ': original control flow and timecodes');
      if (original[id].some(c => c.op === waitOp)) continue;
      const times = new Set(original[id].filter(c => c.op === textOp).map(c => c.time));
      if (times.size < 2) continue;
      const patchedTimes = new Set(translated[id].filter(c => c.op === textOp).map(c => c.time));
      for (const time of times) assert.ok(patchedTimes.has(time), `${label}: automatic dialogue missing at ${time}`);
      timedEntries++;
    }
    messages++;
  }
}
assert.ok(messages > 0 && timedEntries > 0, 'must exercise real packaged automatic dialogue');
console.log(JSON.stringify({game, messages, timedEntries, controls:'unchanged', automaticDialogue:'all original timecodes retained'}));
