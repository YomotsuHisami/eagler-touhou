export const replayImportAccept = ".zip,.rpy,.rpyx";

export interface ReplayMutationQueue {
  run<T>(operation: () => Promise<T>): Promise<T>;
  idle(): Promise<void>;
}

export type ReplayArchiveScanFailure = "unsafe-path" | "duplicate-path" | "file-too-large" | "archive-too-large";

export class ReplayArchiveScanError extends Error {
  readonly reason: ReplayArchiveScanFailure;
  constructor(reason: ReplayArchiveScanFailure) {
    super(reason);
    this.name = "ReplayArchiveScanError";
    this.reason = reason;
  }
}

export interface ReplayArchiveFileInfo {
  name: string;
  originalSize: number;
}

export function createReplayArchiveExtractionGuard({
  maxFileBytes,
  maxExpandedBytes,
}: {
  maxFileBytes: number;
  maxExpandedBytes: number;
}) {
  const paths: string[] = [];
  const pathSet = new Set<string>();
  let expandedBytes = 0;
  return {
    paths,
    filter(info: ReplayArchiveFileInfo): boolean {
      const path = String(info?.name || "");
      if (path.endsWith("/")) return false;
      if (!isSafeReplayArchivePath(path)) throw new ReplayArchiveScanError("unsafe-path");
      const lowerPath = path.toLowerCase();
      if (pathSet.has(lowerPath)) throw new ReplayArchiveScanError("duplicate-path");
      pathSet.add(lowerPath);
      paths.push(path);
      if (replayExtension(basename(path)) === null) return false;
      const size = Number(info?.originalSize);
      if (!Number.isSafeInteger(size) || size < 0 || size > maxFileBytes) {
        throw new ReplayArchiveScanError("file-too-large");
      }
      expandedBytes += size;
      if (expandedBytes > maxExpandedBytes) throw new ReplayArchiveScanError("archive-too-large");
      return true;
    },
  };
}

export function createReplayMutationQueue(): ReplayMutationQueue {
  let tail: Promise<void> = Promise.resolve();
  return {
    run<T>(operation: () => Promise<T>): Promise<T> {
      const run = tail.then(operation, operation);
      tail = run.then(() => undefined, () => undefined);
      return run;
    },
    idle() { return tail; },
  };
}

export interface ReplayArchiveImportEntry {
  sourcePath: string;
  targetPath: string;
  kind: "replay";
}

export type ReplayArchiveImportPlan =
  | { ok: true; entries: ReplayArchiveImportEntry[] }
  | { ok: false; reason: "unsafe-path" | "duplicate-path" | "slots-exhausted" };

function replayExtension(name: string): ".rpy" | ".rpyx" | null {
  const match = /\.rpyx?$/i.exec(name);
  if (!match) return null;
  return match[0].toLowerCase() === ".rpyx" ? ".rpyx" : ".rpy";
}

function basename(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function normalizedPathSet(paths: Iterable<string>): Set<string> {
  return new Set([...paths].map(path => String(path).toLowerCase()));
}

export function isSafeReplayArchivePath(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 240 &&
    !value.includes("\\") && !value.startsWith("/") &&
    !value.split("/").some(part => !part || part === "." || part === "..");
}

export function isReplayFilePath(path: unknown): path is string {
  return typeof path === "string" && /^replay\/[^/]+\.rpyx?$/i.test(path);
}

export function selectReplayExportPaths(paths: Iterable<string>): string[] {
  return [...paths].map(String).filter(isReplayFilePath).sort((a, b) => a.localeCompare(b));
}

export function isValidReplayName(prefix: string, name: unknown): name is string {
  if (typeof name !== "string" || !prefix) return false;
  return new RegExp(`^${escapeRegExp(prefix)}_(?:\\d{2}|ud[0-9a-f]{4})\\.rpyx?$`, "i").test(name);
}

export function sanitizeReplayImportName(name: string): string {
  return String(name).replace(/[^\w.()-]/g, "_");
}

export function isReplayTargetAvailable(existingPaths: Iterable<string>, targetPath: string): boolean {
  if (!isReplayFilePath(targetPath)) return false;
  const occupied = normalizedPathSet(existingPaths);
  return !occupied.has(targetPath.toLowerCase());
}

export function allocateReplayName(
  prefix: string,
  existingPaths: Iterable<string>,
  sourceName: string,
): string | null {
  const extension = replayExtension(sourceName);
  if (!extension) return null;
  const sanitized = sanitizeReplayImportName(sourceName);
  if (isValidReplayName(prefix, sanitized)) {
    const target = `replay/${sanitized}`;
    if (isReplayTargetAvailable(existingPaths, target)) return sanitized;
  }

  const occupied = normalizedPathSet(existingPaths);
  for (let index = 0; index <= 0xffff; index++) {
    const name = `${prefix}_ud${index.toString(16).padStart(4, "0")}${extension}`;
    const target = `replay/${name}`;
    if (!occupied.has(target.toLowerCase())) return name;
  }
  return null;
}

export function isReplayImportFileName(name: unknown): name is string {
  return typeof name === "string" && /\.(?:rpyx?|zip)$/i.test(name);
}

export function planReplayArchiveImport(
  prefix: string,
  archivePaths: Iterable<string>,
  existingPaths: Iterable<string>,
): ReplayArchiveImportPlan {
  const filePaths = [...archivePaths].map(String).filter(path => !path.endsWith("/"));
  if (filePaths.some(path => !isSafeReplayArchivePath(path))) return { ok: false, reason: "unsafe-path" };

  const archiveByLower = new Map<string, string>();
  for (const path of filePaths) {
    const lower = path.toLowerCase();
    if (archiveByLower.has(lower)) return { ok: false, reason: "duplicate-path" };
    archiveByLower.set(lower, path);
  }

  const occupied = [...existingPaths].map(String);
  const entries: ReplayArchiveImportEntry[] = [];
  const replaySources = filePaths
    .filter(path => replayExtension(basename(path)) !== null)
    .sort((a, b) => a.localeCompare(b));

  for (const sourcePath of replaySources) {
    const name = allocateReplayName(prefix, occupied, basename(sourcePath));
    if (!name) return { ok: false, reason: "slots-exhausted" };
    const targetPath = `replay/${name}`;
    entries.push({ sourcePath, targetPath, kind: "replay" });
    occupied.push(targetPath);
  }

  return { ok: true, entries };
}
