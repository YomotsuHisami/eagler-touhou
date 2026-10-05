// External MIDI playback for the titles whose Runtime owns a MIDI music path
// (TH06/TH07/TH08).
//
// The Launcher already receives the Runtime's final, already-sequenced MIDI
// bytes on the `touhou-midi` event (see docs/playbooks/audio.md). This module
// mirrors that byte stream to a Web MIDI output device when the player opts in.
// It owns exactly three things the Runtime must not own:
//
//   1. the `requestMIDIAccess({ sysex: true })` permission request, which must
//      run from a user gesture;
//   2. MIDI message framing, because `MIDIOutput.send()` requires complete,
//      explicitly-statused messages (running status is not allowed on output),
//      and because the two Runtime families disagree about how a short message
//      is recorded (see normalizeRuntimeMidiRecord);
//   3. panic/all-notes-off on teardown so a hardware synth cannot keep notes
//      ringing after the Launcher releases it.
//
// Device choice is an explicit player preference, not a browser side effect:
// the settings surface lists the granted outputs and the stream goes to the
// selected port. When the stored port is gone (unplugged, renamed, or never
// chosen) the first available output takes over so playback is not silenced.

export interface MidiOutputPort {
  readonly id: string;
  readonly name?: string | null;
  readonly manufacturer?: string | null;
  readonly state?: string;
  readonly connection?: string;
  open?(): Promise<unknown>;
  close?(): Promise<unknown>;
  send?(data: readonly number[] | Uint8Array, timestamp?: number): void;
}

export interface MidiOutputMapLike {
  forEach?(callback: (port: MidiOutputPort, id: string) => void): void;
  values?(): IterableIterator<MidiOutputPort>;
  get?(id: string): MidiOutputPort | undefined;
}

export interface MidiAccessLike {
  readonly outputs: MidiOutputMapLike;
  readonly sysexEnabled?: boolean;
  onstatechange?: ((event: unknown) => void) | null;
  addEventListener?(type: string, listener: (event: unknown) => void): void;
  removeEventListener?(type: string, listener: (event: unknown) => void): void;
}

export interface MidiAccessOptions {
  sysex?: boolean;
  software?: boolean;
}

export type RequestMidiAccess = (options?: MidiAccessOptions) => Promise<MidiAccessLike>;

interface NavigatorLike {
  requestMIDIAccess?: unknown;
}

// `[SecureContext]` keeps requestMIDIAccess undefined on insecure origins, so
// feature detection by presence already covers the HTTPS requirement.
export function webMidiAvailable(navigatorLike: unknown): boolean {
  return typeof (navigatorLike as NavigatorLike | null | undefined)?.requestMIDIAccess === "function";
}

// Bind Navigator.requestMIDIAccess without depending on the DOM library
// declaring Web MIDI types. Returns null when the browsing context has no
// Web MIDI support, which is the feature gate the settings UI shows.
export function navigatorMidiAccessRequest(navigatorLike: unknown): RequestMidiAccess | null {
  const candidate = navigatorLike as NavigatorLike | null | undefined;
  if (typeof candidate?.requestMIDIAccess !== "function") return null;
  const request = candidate.requestMIDIAccess as RequestMidiAccess;
  return options => request.call(candidate, options);
}

// External MIDI playback is offered only while the selected music mode is
// MIDI. That is the mode whose bytes this path was built for, so an OGG or
// no-music selection must not expose (or keep) a hardware output switch.
export function externalMidiOffered(midiCapable: boolean, musicMode: string): boolean {
  return midiCapable === true && musicMode === "midi";
}

// Data-byte count for a status byte, or -1 when the byte is not a valid,
// sendable status. Mirrors the non-normative table in the Web MIDI spec.
// 0xF0 (System Exclusive) is handled by splitMidiMessages.
export function midiStatusDataLength(status: number): number {
  const value = status & 0xff;
  if (value < 0x80) return -1;
  const high = value & 0xf0;
  if (high === 0x80 || high === 0x90 || high === 0xa0 || high === 0xb0) return 2;
  if (high === 0xc0 || high === 0xd0) return 1;
  if (high === 0xe0) return 2;
  switch (value) {
    case 0xf1: case 0xf3: return 1;
    case 0xf2: return 2;
    case 0xf6: case 0xf8: case 0xfa: case 0xfb: case 0xfc: case 0xfe: case 0xff: return 0;
    default: return -1;
  }
}

// One `touhou-midi` event carries exactly one Runtime MIDI message, but the two
// Runtime families record the one-data-byte message types differently:
//
//   - TH06/TH07 (src/midi/MidiWeb.cpp) dispatch every short message as a fixed
//     three-byte record, so Program Change (0xC0-0xCF) and Channel Pressure
//     (0xD0-0xDF) arrive as `[status, data, 0]`;
//   - TH08 (th08_web/cpp/platform/GameAudioManager.cpp) dispatches the real
//     two-byte length.
//
// `splitMidiMessages` frames a byte stream, so it reads TH06/TH07's pad as a
// running-status message and emits a phantom "program 0" right after every real
// program change; an external device then applies that phantom to the part
// instead of the authored instrument. Trimming the padded record restores the
// authored message and leaves TH08's exact-length records untouched.
export function normalizeRuntimeMidiRecord(bytes: ArrayLike<number>): ArrayLike<number> {
  const length = Math.max(0, Number(bytes?.length) || 0);
  if (length !== 3) return bytes;
  const status = Number(bytes[0]) & 0xff;
  const high = status & 0xf0;
  if (high !== 0xc0 && high !== 0xd0) return bytes;
  const data = Number(bytes[1]) & 0xff;
  // Only the exact shape the Runtime produces is rewritten: one data byte plus
  // the zero pad. Anything else is left to splitMidiMessages, so an authored
  // running-status pair is never silently shortened here.
  if (data >= 0x80 || (Number(bytes[2]) & 0xff) !== 0x00) return bytes;
  return [status, data];
}

// Split a Runtime MIDI byte stream into discrete, sendable messages:
//   - running status is expanded, because Web MIDI output forbids it;
//   - System Real Time bytes (0xF8-0xFF) pass through as one-byte messages;
//   - a System Exclusive message is terminated with 0xF7 when the Runtime
//     omitted it, because Web MIDI validates SysEx as `F0 ... F7`;
//   - invalid status bytes and truncated messages are dropped rather than
//     forwarded, so one malformed event cannot poison a device port.
export function splitMidiMessages(bytes: ArrayLike<number>): number[][] {
  const messages: number[][] = [];
  const length = Math.max(0, Number(bytes?.length) || 0);
  const at = (index: number): number => Number(bytes[index]) & 0xff;
  let index = 0;
  let runningStatus = 0;
  while (index < length) {
    const byte = at(index);
    if (byte >= 0xf8) {
      messages.push([byte]);
      index += 1;
      continue;
    }
    if (byte === 0xf0) {
      const message = [0xf0];
      index += 1;
      while (index < length) {
        const payload = at(index);
        if (payload === 0xf7) {
          index += 1;
          break;
        }
        // System Real Time bytes may legally appear inside a System Exclusive
        // stream on the wire, but they are not part of its payload.
        if (payload >= 0xf8) {
          index += 1;
          continue;
        }
        // A non-realtime status byte means the Runtime never terminated this
        // message; end it here and let the next iteration frame the status.
        if (payload >= 0x80) break;
        message.push(payload);
        index += 1;
      }
      message.push(0xf7);
      messages.push(message);
      runningStatus = 0;
      continue;
    }
    let status = byte;
    if (byte >= 0x80) {
      index += 1;
      if (byte >= 0xf1) {
        runningStatus = 0;
        const dataLength = midiStatusDataLength(byte);
        if (dataLength < 0) continue;
        const message = [byte];
        let taken = 0;
        while (taken < dataLength && index < length && at(index) < 0x80) {
          message.push(at(index));
          index += 1;
          taken += 1;
        }
        if (taken === dataLength) messages.push(message);
        continue;
      }
      runningStatus = byte;
    } else if (runningStatus) {
      status = runningStatus;
    } else {
      index += 1;
      continue;
    }
    const dataLength = midiStatusDataLength(status);
    if (dataLength <= 0) {
      index += 1;
      runningStatus = 0;
      continue;
    }
    const message = [status];
    let taken = 0;
    while (taken < dataLength && index < length && at(index) < 0x80) {
      message.push(at(index));
      index += 1;
      taken += 1;
    }
    if (taken === dataLength) messages.push(message);
  }
  return messages;
}

export function externalMidiPanicMessages(): number[][] {
  const messages: number[][] = [];
  for (let channel = 0; channel < 16; channel += 1) {
    messages.push([0xb0 | channel, 0x78, 0x00]); // All Sound Off
    messages.push([0xb0 | channel, 0x7b, 0x00]); // All Notes Off
    messages.push([0xb0 | channel, 0x40, 0x00]); // Sustain off
  }
  return messages;
}

export interface ExternalMidiDeviceOptions {
  requestAccess?: RequestMidiAccess | null;
  onChange?: () => void;
}

export interface ExternalMidiOutputInfo {
  id: string;
  name: string;
}

function collectOutputs(access: MidiAccessLike | null): MidiOutputPort[] {
  if (!access?.outputs) return [];
  const ports: MidiOutputPort[] = [];
  const push = (port: MidiOutputPort | null | undefined) => {
    if (!port || typeof port !== "object") return;
    if (port.state === "disconnected") return;
    if (typeof port.send !== "function") return;
    if (!ports.includes(port)) ports.push(port);
  };
  const outputs = access.outputs;
  if (typeof outputs.forEach === "function") outputs.forEach(port => push(port));
  else if (typeof outputs.values === "function") for (const port of outputs.values()) push(port);
  return ports;
}

export class ExternalMidiDevice {
  private readonly requestAccess: RequestMidiAccess | null;
  private readonly onChange: () => void;
  private access: MidiAccessLike | null = null;
  private pending: Promise<MidiAccessLike> | null = null;
  private preferredId = "";
  private readonly handleStateChange = (): void => {
    // The MIDIOutputMap view is live, so a statechange only needs to re-render
    // the Launcher's device status; outputs() re-reads the map on demand.
    this.onChange();
  };

  constructor(options: ExternalMidiDeviceOptions = {}) {
    this.requestAccess = typeof options.requestAccess === "function" ? options.requestAccess : null;
    this.onChange = typeof options.onChange === "function" ? options.onChange : () => {};
  }

  get supported(): boolean {
    return this.requestAccess !== null;
  }

  // Whether an access object has been granted for this document. Access is kept
  // for the page lifetime so re-enabling never re-prompts the player.
  get granted(): boolean {
    return this.access !== null;
  }

  get sysexEnabled(): boolean {
    return this.access?.sysexEnabled === true;
  }

  outputs(): MidiOutputPort[] {
    return collectOutputs(this.access);
  }

  outputCount(): number {
    return this.outputs().length;
  }

  outputInfo(): ExternalMidiOutputInfo[] {
    return this.outputs().map(port => ({ id: port.id, name: port.name || port.manufacturer || port.id }));
  }

  // The persisted player choice. It is allowed to reference a port that is not
  // currently present; effectiveOutput() then falls back instead of failing.
  selectedId(): string {
    return this.preferredId;
  }

  setSelectedId(id: string): void {
    this.preferredId = typeof id === "string" ? id : "";
  }

  effectiveOutput(): MidiOutputPort | null {
    const outputs = this.outputs();
    if (!outputs.length) return null;
    return outputs.find(port => port.id === this.preferredId) ?? outputs[0];
  }

  effectiveOutputId(): string {
    return this.effectiveOutput()?.id ?? "";
  }

  // Must be called from a user gesture the first time: requestMIDIAccess may
  // prompt. `sysex: true` is required for the Runtime's System Exclusive
  // traffic and is the stronger permission, so it is always requested.
  ensureAccess(): Promise<MidiAccessLike> {
    if (this.access) return Promise.resolve(this.access);
    if (this.pending) return this.pending;
    if (!this.requestAccess) return Promise.reject(new Error("web-midi-unsupported"));
    const request = this.requestAccess;
    this.pending = Promise.resolve()
      .then(() => request({ sysex: true }))
      .then(access => {
        if (!access || typeof access !== "object" || !access.outputs) {
          throw new Error("web-midi-invalid-access");
        }
        this.access = access;
        this.attach(access);
        this.pending = null;
        this.onChange();
        return access;
      })
      .catch(error => {
        this.pending = null;
        throw error;
      });
    return this.pending;
  }

  // Best-effort implicit open from a non-gesture path (game launch). Ports are
  // opened implicitly by send() anyway; this only surfaces exclusivity errors
  // early on platforms that cannot share devices.
  async openOutputs(): Promise<number> {
    const outputs = this.outputs();
    for (const output of outputs) {
      if (typeof output.open !== "function" || output.connection === "open") continue;
      try { await output.open(); } catch {}
    }
    return outputs.length;
  }

  // Queue one already-framed message to the selected output. Returns false when
  // there is no usable port or the port rejects the message.
  sendMessage(message: readonly number[]): boolean {
    if (!this.granted || !message.length) return false;
    const output = this.effectiveOutput();
    if (!output) return false;
    try {
      output.send?.(message);
      return true;
    } catch {
      return false;
    }
  }

  // Mirror a Runtime MIDI event. Each event holds one message, so the padded
  // TH06/TH07 record shape is normalized before stream framing. Returns the
  // number of messages accepted by the selected device.
  send(bytes: ArrayLike<number>): number {
    if (!this.granted) return 0;
    let sent = 0;
    for (const message of splitMidiMessages(normalizeRuntimeMidiRecord(bytes))) if (this.sendMessage(message)) sent += 1;
    return sent;
  }

  // Panic every granted output: a previous selection may still be holding notes
  // after the player switched devices.
  panic(): void {
    if (!this.granted) return;
    for (const message of externalMidiPanicMessages()) {
      for (const output of this.outputs()) {
        try { output.send?.(message); } catch {}
      }
    }
  }

  // Drop the MIDIAccess reference and its listener. The permission itself stays
  // granted for the origin, so a later ensureAccess() resolves silently.
  release(): void {
    if (this.access) this.detach(this.access);
    this.access = null;
    this.pending = null;
  }

  private attach(access: MidiAccessLike): void {
    try { access.onstatechange = this.handleStateChange; } catch {}
    access.addEventListener?.("statechange", this.handleStateChange);
  }

  private detach(access: MidiAccessLike): void {
    try { if (access.onstatechange === this.handleStateChange) access.onstatechange = null; } catch {}
    access.removeEventListener?.("statechange", this.handleStateChange);
  }
}
