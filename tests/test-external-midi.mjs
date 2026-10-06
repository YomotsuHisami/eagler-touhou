import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

// Import the frontend manifest first: it owns ensureLauncherBuild(), so this
// test also runs standalone without a stale .cache build.
import { resolveFrontendPackageSource } from "../lib/frontend-manifest.mjs";
import {
  ExternalMidiDevice,
  externalMidiOffered,
  externalMidiPanicMessages,
  midiStatusDataLength,
  navigatorMidiAccessRequest,
  normalizeRuntimeMidiRecord,
  splitMidiMessages,
  webMidiAvailable,
} from "../.cache/build/browser/assets/launcher/external-midi.mjs";
import {
  DEFAULT_GAME_OPTIONS,
  normalizeStoredGamePreferences,
  serializeGamePreferences,
} from "../.cache/build/browser/assets/launcher/game-preferences.mjs";
import { PRODUCT_GAMES } from "../lib/contracts/product-catalog.mjs";

// --- capability detection -------------------------------------------------

assert.equal(webMidiAvailable({ requestMIDIAccess() {} }), true);
assert.equal(webMidiAvailable({}), false);
assert.equal(webMidiAvailable(null), false);
assert.equal(webMidiAvailable(undefined), false);
assert.equal(navigatorMidiAccessRequest(null), null, "a context without Web MIDI must not offer an access request");
assert.equal(navigatorMidiAccessRequest({}), null);

// --- when the option is offered -------------------------------------------

// The switch appears only for a MIDI-capable title whose music selection is
// MIDI; OGG/no-music must not expose a hardware output control.
assert.equal(externalMidiOffered(true, "midi"), true);
for (const mode of ["ogg-stream", "ogg-full", "none", ""]) {
  assert.equal(externalMidiOffered(true, mode), false, `${mode}: only the MIDI music selection offers external MIDI`);
}
assert.equal(externalMidiOffered(false, "midi"), false,
  "a title without a MIDI music path must never offer external MIDI");

// --- status byte framing --------------------------------------------------

assert.equal(midiStatusDataLength(0x80), 2);
assert.equal(midiStatusDataLength(0x90), 2);
assert.equal(midiStatusDataLength(0xb0), 2);
assert.equal(midiStatusDataLength(0xc0), 1, "program change carries one data byte");
assert.equal(midiStatusDataLength(0xd0), 1, "channel pressure carries one data byte");
assert.equal(midiStatusDataLength(0xe0), 2);
assert.equal(midiStatusDataLength(0xf1), 1);
assert.equal(midiStatusDataLength(0xf2), 2);
assert.equal(midiStatusDataLength(0xf6), 0);
assert.equal(midiStatusDataLength(0xf8), 0, "System Real Time messages are one byte");
assert.equal(midiStatusDataLength(0xff), 0);
for (const invalid of [0x7f, 0xf4, 0xf5, 0xf7, 0xf9, 0xfd]) {
  assert.equal(midiStatusDataLength(invalid), -1, `0x${invalid.toString(16)} is not a sendable status byte`);
}

// --- message splitting ----------------------------------------------------

assert.deepEqual(splitMidiMessages([]), []);
assert.deepEqual(splitMidiMessages([0x90, 60, 0x7f]), [[0x90, 60, 0x7f]]);
assert.deepEqual(splitMidiMessages([0xc0, 5]), [[0xc0, 5]]);
assert.deepEqual(splitMidiMessages([0x90, 60, 0x7f, 0x80, 60, 0x00]),
  [[0x90, 60, 0x7f], [0x80, 60, 0x00]])
assert.deepEqual(splitMidiMessages([0x90, 60, 0x7f, 61, 0x7f]),
  [[0x90, 60, 0x7f], [0x90, 61, 0x7f]],
  "running status must be expanded: Web MIDI output forbids it");

const sysex = [0xf0, 0x7e, 0x7f, 0x09, 0x01, 0xf7];
assert.deepEqual(splitMidiMessages(sysex), [sysex], "a terminated System Exclusive message must pass through");
assert.deepEqual(splitMidiMessages([0xf0, 0x7e, 0x7f, 0x09, 0x01]),
  [[0xf0, 0x7e, 0x7f, 0x09, 0x01, 0xf7]],
  "an unterminated Runtime System Exclusive message must be terminated before send()");
assert.deepEqual(splitMidiMessages([...sysex, 0x90, 60, 0x7f]),
  [sysex, [0x90, 60, 0x7f]],
  "a System Exclusive message must not swallow the channel message after it");

assert.deepEqual(splitMidiMessages([0xf8]), [[0xf8]]);
assert.deepEqual(splitMidiMessages([0xf8, 0x90, 60, 0x7f]), [[0xf8], [0x90, 60, 0x7f]]);
assert.deepEqual(splitMidiMessages([0xff]), [[0xff]]);

assert.deepEqual(splitMidiMessages([0x90, 60]), [], "a truncated channel message must be dropped");
assert.deepEqual(splitMidiMessages([0x7f]), [], "a stray data byte must be dropped");
assert.deepEqual(splitMidiMessages([0xf4]), [], "an invalid status byte must be dropped");
assert.deepEqual(splitMidiMessages([0xf0, 0x7e, 0x01, 0x90, 60, 0x7f]),
  [[0xf0, 0x7e, 0x01, 0xf7], [0x90, 60, 0x7f]],
  "an unterminated System Exclusive message must not consume later message bytes");
assert.deepEqual(splitMidiMessages([0xf0, 0x7e, 0xf8, 0x01, 0xf7]),
  [[0xf0, 0x7e, 0x01, 0xf7]],
  "an interleaved System Real Time byte is not System Exclusive payload");

// --- Runtime record normalization -----------------------------------------

// TH06/TH07 (MidiWeb.cpp) dispatch every short message as a fixed three-byte
// record, so the one-data-byte message types carry a meaningless pad. Framing
// that pad as running status delivered a phantom "program 0" after every
// authored Program Change, which the external device applied to the part.
assert.deepEqual(normalizeRuntimeMidiRecord([0xc0, 0x19, 0x00]), [0xc0, 0x19],
  "a padded Program Change record must lose its pad");
assert.deepEqual(normalizeRuntimeMidiRecord([0xc1, 0x00, 0x00]), [0xc1, 0x00],
  "a padded Program Change to program 0 stays program 0");
assert.deepEqual(normalizeRuntimeMidiRecord([0xd3, 0x40, 0x00]), [0xd3, 0x40],
  "a padded Channel Pressure record must lose its pad");

// TH08 (GameAudioManager.cpp) sends the real two-byte length, and every other
// message type already uses its full record.
for (const record of [[0xc0, 0x19], [0x80, 60, 0x00], [0x90, 60, 0x7f], [0xa0, 60, 0x40], [0xb0, 0, 3], [0xe0, 0, 0x40], sysex, [0xf8]]) {
  assert.deepEqual(normalizeRuntimeMidiRecord(record), record,
    `${record.join(",")}: an exact-length record must pass through unchanged`);
}
assert.deepEqual(normalizeRuntimeMidiRecord([0xc0, 0x19, 0x80]), [0xc0, 0x19, 0x80],
  "a malformed record is not rewritten");
assert.deepEqual(normalizeRuntimeMidiRecord([0xc0, 0x19, 0x7f]), [0xc0, 0x19, 0x7f],
  "only the zero-padded record shape is rewritten; an authored trailing byte stays");
assert.deepEqual(splitMidiMessages(normalizeRuntimeMidiRecord([0xc2, 0x30, 0x00])),
  [[0xc2, 0x30]],
  "one authored Program Change must remain one sent message");

// --- panic ----------------------------------------------------------------

const panic = externalMidiPanicMessages();
assert.equal(panic.length, 48, "panic covers 16 channels x (all sound off, all notes off, sustain off)");
for (let channel = 0; channel < 16; channel += 1) {
  assert.deepEqual(panic.slice(channel * 3, channel * 3 + 3), [
    [0xb0 | channel, 0x78, 0x00],
    [0xb0 | channel, 0x7b, 0x00],
    [0xb0 | channel, 0x40, 0x00],
  ]);
}

// --- device manager -------------------------------------------------------

function fakePort(id, { state = "connected" } = {}) {
  return {
    id,
    name: `Port ${id}`,
    state,
    connection: "closed",
    sent: [],
    opened: 0,
    send(data) { this.sent.push([...data]); },
    async open() { this.opened += 1; this.connection = "open"; },
  };
}

function fakeAccess(ports, { sysexEnabled = true } = {}) {
  const map = new Map(ports.map(port => [port.id, port]));
  return {
    sysexEnabled,
    onstatechange: null,
    outputs: {
      forEach(callback) { for (const [id, port] of map) callback(port, id); },
      get(id) { return map.get(id); },
    },
  };
}

// The request helper must preserve the Navigator receiver and pass the SysEx
// option through unchanged.
const boundNavigator = {
  requestMIDIAccess(options) {
    assert.equal(this, boundNavigator, "requestMIDIAccess must be invoked on its Navigator receiver");
    assert.deepEqual(options, { sysex: true });
    return Promise.resolve(fakeAccess([]));
  },
};
const boundRequest = navigatorMidiAccessRequest(boundNavigator);
assert.equal(typeof boundRequest, "function");
await boundRequest({ sysex: true });

const unsupported = new ExternalMidiDevice({});
assert.equal(unsupported.supported, false);
assert.equal(unsupported.granted, false);
assert.equal(unsupported.send([0x90, 60, 0x7f]), 0);
await assert.rejects(unsupported.ensureAccess(), /web-midi-unsupported/);

const invalidDevice = new ExternalMidiDevice({ requestAccess: async () => null });
await assert.rejects(invalidDevice.ensureAccess(), /web-midi-invalid-access/);

const firstPort = fakePort("a");
const secondPort = fakePort("b");
const disconnectedPort = fakePort("c", { state: "disconnected" });
const untouchedPort = fakePort("unused");
let changeCount = 0;
const access = fakeAccess([firstPort, secondPort, disconnectedPort, untouchedPort]);
const device = new ExternalMidiDevice({
  requestAccess: async options => {
    assert.deepEqual(options, { sysex: true }, "System Exclusive access must be requested");
    return access;
  },
  onChange: () => { changeCount += 1; },
});

assert.equal(device.granted, false);
assert.equal(device.selectedId(), "", "no device is selected before the player chooses one");
assert.equal(device.send([0x90, 60, 0x7f]), 0, "no bytes may leave before permission is granted");

await device.ensureAccess();
assert.equal(device.granted, true);
assert.equal(device.sysexEnabled, true);
assert.equal(device.outputCount(), 3, "a disconnected port must not be offered for selection");
assert.deepEqual(device.outputInfo().map(output => output.id), ["a", "b", "unused"]);
assert.equal(device.effectiveOutputId(), "a", "with no stored choice the first output is used");
assert.equal(changeCount, 1, "granting access must notify the Launcher so it can render status");

device.panic();
assert.equal(firstPort.sent.length, 0, "permission alone must not send stop messages");
assert.equal(await device.openOutputs(), 1);
assert.equal(firstPort.opened, 1);
assert.equal(secondPort.opened, 0, "unused ports must remain unopened");

assert.equal(device.send([0x90, 60, 0x7f]), 1);
assert.deepEqual(firstPort.sent, [[0x90, 60, 0x7f]]);
assert.deepEqual(secondPort.sent, [], "only the selected output receives the stream");
assert.deepEqual(disconnectedPort.sent, []);

// An explicit selection moves the whole stream to that port.
device.setSelectedId("b");
assert.equal(device.selectedId(), "b");
assert.equal(device.effectiveOutputId(), "b");
assert.equal(device.send([0x90, 61, 0x7f]), 1);
assert.deepEqual(secondPort.sent, [[0x90, 61, 0x7f]]);
assert.deepEqual(firstPort.sent, [[0x90, 60, 0x7f]], "switching device stops feeding the previous port");

assert.equal(device.send([0x90, 60, 0x7f, 61, 0x7f]), 2, "running status expands into separate messages");
assert.deepEqual(secondPort.sent.at(-1), [0x90, 61, 0x7f]);

// A TH06/TH07 padded Program Change record must reach the device exactly once,
// with the authored program; the trailing pad is record padding, not a second
// (running status) program change to program 0.
const beforePaddedRecord = secondPort.sent.length;
assert.equal(device.send([0xc1, 0x26, 0x00]), 1,
  "a padded Program Change is one message, not two");
assert.deepEqual(secondPort.sent.slice(beforePaddedRecord), [[0xc1, 0x26]]);
// TH08's exact-length record for the same message behaves identically.
assert.equal(device.send([0xc1, 0x26]), 1);
assert.deepEqual(secondPort.sent.slice(beforePaddedRecord + 1), [[0xc1, 0x26]]);

// A stored id whose port is gone must fall back instead of silencing music.
device.setSelectedId("unplugged");
assert.equal(device.effectiveOutputId(), "a", "a missing selection falls back to the first granted output");
device.setSelectedId("b");

device.send(sysex);
assert.deepEqual(secondPort.sent.at(-1), sysex, "System Exclusive bytes reach the selected device unchanged");

const firstBeforePanic = firstPort.sent.length;
const secondBeforePanic = secondPort.sent.length;
device.panic();
assert.equal(untouchedPort.sent.length, 0, "panic must never touch unused devices");
assert.equal(untouchedPort.opened, 0);
assert.equal(secondPort.sent.length - secondBeforePanic, 48);
assert.equal(firstPort.sent.length - firstBeforePanic, 48,
  "panic covers used outputs, including the previous selection");

// A statechange must surface device hotplug to the Launcher.
const changesBefore = changeCount;
access.onstatechange?.();
assert.equal(changeCount, changesBefore + 1);

device.release();
assert.equal(device.granted, false);
assert.equal(device.send([0x90, 60, 0x7f]), 0);
assert.equal(access.onstatechange, null, "release must detach the statechange handler");

// Re-enabling reuses the origin permission instead of prompting again.
await device.ensureAccess();
assert.equal(device.granted, true);
assert.equal(device.effectiveOutputId(), "b", "the stored choice survives while the page keeps its access");

const openFailure = fakePort("open-failure");
openFailure.open = async () => { throw new Error("exclusive"); };
const failedOpen = new ExternalMidiDevice({ requestAccess: async () => fakeAccess([openFailure, fakePort("unused-working")]) });
await failedOpen.ensureAccess();
assert.equal(await failedOpen.openOutputs(), 0, "a selected-port open failure must not be reported as success");

// A selected port that rejects the message must not throw into the MIDI event
// handler; the next message can still succeed.
const brokenPort = fakePort("broken");
brokenPort.send = () => { throw new Error("exclusive"); };
const mixed = new ExternalMidiDevice({ requestAccess: async () => fakeAccess([brokenPort, fakePort("ok")]) });
await mixed.ensureAccess();
assert.equal(mixed.effectiveOutputId(), "broken");
assert.equal(mixed.send([0x90, 60, 0x7f]), 0, "a rejecting selected port reports no delivery");
mixed.setSelectedId("ok");
assert.equal(mixed.send([0x90, 60, 0x7f]), 1, "choosing a working port restores delivery");

// A resolution without exclusive access must stay visible: the Launcher refuses
// to take over the audible path when System Exclusive traffic cannot be sent.
const noSysex = new ExternalMidiDevice({
  requestAccess: async () => fakeAccess([fakePort("no-sysex")], { sysexEnabled: false }),
});
await noSysex.ensureAccess();
assert.equal(noSysex.granted, true);
assert.equal(noSysex.sysexEnabled, false, "sysexEnabled must reflect the granted MIDIAccess");

// --- product gating, session switch and stored device ----------------------

const midiGames = Object.entries(PRODUCT_GAMES)
  .filter(([, product]) => product.musicCapabilities.midi)
  .map(([game]) => game);
assert.deepEqual(midiGames, ["th06", "th07", "th08"],
  "external MIDI is offered only for the three titles that own a MIDI music path");

// The on/off switch is session-only: it must not be a persisted GameOptions
// field, it must not be written when preferences are saved, and a stale stored
// value from an earlier build must not resurrect it.
assert.equal(Object.hasOwn(DEFAULT_GAME_OPTIONS, "externalMidiEnabled"), false,
  "external MIDI playback is session-only and must not be a GameOptions field");
const staleSwitch = normalizeStoredGamePreferences(
  { options: { externalMidiEnabled: true } },
  { thpracAvailable: true, webAudioAvailable: true, externalMidiAvailable: true },
);
assert.equal(Object.hasOwn(staleSwitch.options, "externalMidiEnabled"), false,
  "a stale stored switch must not resurrect external MIDI playback");
const serialized = serializeGamePreferences({
  options: { ...DEFAULT_GAME_OPTIONS, externalMidiDeviceId: "port-9" },
  music: "midi",
  musicPreference: "midi",
  musicPreferenceExplicit: true,
});
assert.equal(Object.hasOwn(serialized.options, "externalMidiEnabled"), false,
  "saving preferences must never write the external MIDI switch");
assert.equal(serialized.options.externalMidiDeviceId, "port-9",
  "the remembered output is the only persisted part of the feature");

// The remembered output survives a reload but cannot outlive MIDI availability.
assert.equal(normalizeStoredGamePreferences(
  { options: { externalMidiDeviceId: "port-9" } },
  { thpracAvailable: true, webAudioAvailable: true, externalMidiAvailable: true },
).options.externalMidiDeviceId, "port-9", "the picked output must survive a reload");
assert.equal(normalizeStoredGamePreferences(
  { options: { externalMidiDeviceId: "port-9" } },
  { thpracAvailable: true, webAudioAvailable: true, externalMidiAvailable: false },
).options.externalMidiDeviceId, "",
  "an unsupported browser or a non-MIDI title must not keep a stale device id");
assert.equal(normalizeStoredGamePreferences(null, { thpracAvailable: true, webAudioAvailable: true })
  .options.externalMidiDeviceId, "", "no device is preselected by default");
assert.equal(normalizeStoredGamePreferences(
  { options: { externalMidiDeviceId: 42 } },
  { thpracAvailable: true, webAudioAvailable: true, externalMidiAvailable: true },
).options.externalMidiDeviceId, "", "a non-string stored device id must fall back to the default");

// --- settings surface -----------------------------------------------------

const index = await readFile(resolveFrontendPackageSource("index.html"), "utf8");
for (const id of [
  "externalMidiOption", "externalMidiToggle", "externalMidiDeviceOption", "externalMidiDeviceSelect",
  "mpExternalMidiOption", "mpExternalMidiToggle", "mpExternalMidiDeviceOption", "mpExternalMidiDeviceSelect",
]) {
  assert.match(index, new RegExp(`id="${id}"`), `advanced settings must expose #${id}`);
}
assert.match(index, /settings\.externalMidi/, "the advanced settings switch must be translatable");
assert.match(index, /<span[^>]*data-i18n="settings\.externalMidi"/);
assert.match(index, /<select[^>]*id="externalMidiDeviceSelect"/, "the device picker must be a select control");
assert.match(index, /<select[^>]*id="mpExternalMidiDeviceSelect"/, "the multiplayer panel needs the same device picker");

console.log(JSON.stringify({
  externalMidi: "PASS",
  games: midiGames,
  panicMessages: panic.length,
  transport: "touhou-midi -> selected external Web MIDI output",
}));
