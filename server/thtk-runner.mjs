import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";

const SAFE_ENTRY = /^[a-z0-9_.-]+$/i;
const SUPPORTED_ARCHIVE_VERSIONS = new Set([6, 7, 8, 9, 10, 11]);

function assertArchiveVersion(version) {
  if (!SUPPORTED_ARCHIVE_VERSIONS.has(version)) throw new TypeError("unsupported archive version");
}

function run(command, args, { cwd, timeoutMs }) {
  return new Promise((resolveRun, reject) => {
    const child = spawn(command, args, { cwd, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    const stdout = [];
    const stderr = [];
    let outputBytes = 0;
    const collect = target => chunk => {
      outputBytes += chunk.length;
      if (outputBytes <= 1024 * 1024) target.push(chunk);
    };
    child.stdout.on("data", collect(stdout));
    child.stderr.on("data", collect(stderr));
    const timer = setTimeout(() => child.kill(), timeoutMs);
    child.once("error", error => {
      clearTimeout(timer);
      reject(error);
    });
    child.once("close", code => {
      clearTimeout(timer);
      if (code === 0) {
        resolveRun({ stdout: Buffer.concat(stdout), stderr: Buffer.concat(stderr) });
        return;
      }
      const detail = Buffer.concat(stderr).toString("utf8").trim() || Buffer.concat(stdout).toString("utf8").trim();
      reject(new Error(`${basename(command)} exited with code ${code}${detail ? `: ${detail}` : ""}`));
    });
  });
}

export class ThtkRunner {
  constructor({ thdat, thmsg, temporaryRoot = tmpdir(), timeoutMs = 30000 } = {}) {
    if (typeof thdat !== "string" || !thdat) throw new TypeError("thdat path is required");
    if (typeof thmsg !== "string" || !thmsg) throw new TypeError("thmsg path is required");
    if (!Number.isInteger(timeoutMs) || timeoutMs < 1000) throw new TypeError("invalid thtk timeout");
    this.thdat = resolve(thdat);
    this.thmsg = resolve(thmsg);
    this.temporaryRoot = resolve(temporaryRoot);
    this.timeoutMs = timeoutMs;
  }

  async withTemporaryDirectory(callback) {
    const directory = await mkdtemp(join(this.temporaryRoot, "eagler-thtk-"));
    try {
      return await callback(directory);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }

  async extractArchiveEntry(archive, entry, version) {
    if (typeof entry !== "string" || !SAFE_ENTRY.test(entry)) throw new TypeError("invalid archive entry");
    assertArchiveVersion(version);
    const archivePath = resolve(archive);
    return this.withTemporaryDirectory(async directory => {
      await run(this.thdat, ["-x", String(version), archivePath, entry], {
        cwd: directory,
        timeoutMs: this.timeoutMs
      });
      return readFile(join(directory, entry));
    });
  }

  async dumpMessage(message, version) {
    if (!Buffer.isBuffer(message) && !(message instanceof Uint8Array)) throw new TypeError("message bytes are required");
    assertArchiveVersion(version);
    return this.withTemporaryDirectory(async directory => {
      const input = join(directory, "input.dat");
      const output = join(directory, "output.txt");
      await writeFile(input, message);
      await run(this.thmsg, ["-d", String(version), input, output], {
        cwd: directory,
        timeoutMs: this.timeoutMs
      });
      return readFile(output);
    });
  }

  async compileMessage(source, version) {
    if (!Buffer.isBuffer(source) && !(source instanceof Uint8Array)) throw new TypeError("message source bytes are required");
    assertArchiveVersion(version);
    return this.withTemporaryDirectory(async directory => {
      const input = join(directory, "input.txt");
      const output = join(directory, "output.dat");
      await writeFile(input, source);
      await run(this.thmsg, ["-c", String(version), input, output], {
        cwd: directory,
        timeoutMs: this.timeoutMs
      });
      return readFile(output);
    });
  }

  // TH10 endings (e*.msg) use the same thmsg tool with -e and the END_<ver>
  // opcode set; thcrap routes them through patch_msg_end/END_TH10.
  async dumpEnding(message, version) {
    if (!Buffer.isBuffer(message) && !(message instanceof Uint8Array)) throw new TypeError("message bytes are required");
    assertArchiveVersion(version);
    return this.withTemporaryDirectory(async directory => {
      const input = join(directory, "input.dat");
      const output = join(directory, "output.txt");
      await writeFile(input, message);
      await run(this.thmsg, ["-e", "-d", String(version), input, output], {
        cwd: directory,
        timeoutMs: this.timeoutMs
      });
      return readFile(output);
    });
  }

  async compileEnding(source, version) {
    if (!Buffer.isBuffer(source) && !(source instanceof Uint8Array)) throw new TypeError("message source bytes are required");
    assertArchiveVersion(version);
    return this.withTemporaryDirectory(async directory => {
      const input = join(directory, "input.txt");
      const output = join(directory, "output.dat");
      await writeFile(input, source);
      await run(this.thmsg, ["-e", "-c", String(version), input, output], {
        cwd: directory,
        timeoutMs: this.timeoutMs
      });
      return readFile(output);
    });
  }
}
