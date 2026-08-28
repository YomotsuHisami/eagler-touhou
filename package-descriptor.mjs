export const PACKAGE_DESCRIPTOR_SCHEMA = "eagler-touhou/package/1";
export const PLAYER_PROTOCOL_V1 = "eagler-touhou/player/1";

const GAME_ID = /^th\d{2}$/;
const FILE_ID = /^[a-z0-9][a-z0-9._:-]{0,127}$/i;
const COMPONENT_ID = FILE_ID;
const REVISION = /^[a-z0-9][a-z0-9._:-]{0,127}$/i;
const RUNTIME_VARIANT = /^[a-z0-9][a-z0-9._-]{0,63}$/i;

function isPlainObject(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function assertRelativeSource(value, label) {
  if (typeof value !== "string" || !value || value.includes("\\") || value.startsWith("/") || value.includes("\0")) {
    throw new Error(`${label}: invalid source path`);
  }
  const parts = value.split("/");
  if (parts.some(part => !part || part === "." || part === "..")) throw new Error(`${label}: unsafe source path`);
}

function assertTarget(value, label) {
  if (typeof value !== "string" || !value.startsWith("/") || value.includes("\\") || value.includes("\0")) {
    throw new Error(`${label}: invalid target path`);
  }
  if (value.split("/").some((part, index) => index > 0 && (!part || part === "." || part === ".."))) {
    throw new Error(`${label}: unsafe target path`);
  }
}

function assertFileRefs(refs, files, label) {
  if (!Array.isArray(refs)) throw new Error(`${label}: files must be an array`);
  const seen = new Set();
  for (const id of refs) {
    if (typeof id !== "string" || !Object.hasOwn(files, id)) throw new Error(`${label}: unknown file ${String(id)}`);
    if (seen.has(id)) throw new Error(`${label}: duplicate file ${id}`);
    seen.add(id);
  }
}

function validateRuntime(runtime, files, supportedRuntimeTypes, label) {
  if (!isPlainObject(runtime) || typeof runtime.type !== "string" ||
      !supportedRuntimeTypes.includes(runtime.type) || typeof runtime.entry !== "string" ||
      runtime.playerProtocol !== PLAYER_PROTOCOL_V1) {
    throw new Error(`invalid ${label} descriptor`);
  }
  if (!Object.hasOwn(files, runtime.entry)) throw new Error(`${label} entry does not reference a declared file`);
  if (runtime.bootstrap != null) {
    assertFileRefs(runtime.bootstrap, files, `${label} bootstrap`);
    if (!runtime.bootstrap.includes(runtime.entry)) throw new Error(`${label} bootstrap must include the runtime entry`);
  }
}

function validateRuntimeRequirement(requirement, files) {
  if (!isPlainObject(requirement) || typeof requirement.protocol !== "string" || !requirement.protocol ||
      typeof requirement.target !== "string" || !GAME_ID.test(requirement.target) ||
      typeof requirement.dataFile !== "string" || !Object.hasOwn(files, requirement.dataFile) ||
      (requirement.dataLayout != null && (typeof requirement.dataLayout !== "string" || !requirement.dataLayout))) {
    throw new Error("invalid package runtime requirement");
  }
}

export function resolvePackageRuntime(descriptor, requestedVariant = null) {
  if (isPlainObject(descriptor?.runtimes)) {
    const variant = requestedVariant ?? descriptor.defaultRuntime;
    if (typeof variant !== "string" || !Object.hasOwn(descriptor.runtimes, variant)) {
      throw new Error(`unknown package runtime variant: ${String(variant)}`);
    }
    return { variant, runtime: descriptor.runtimes[variant] };
  }
  if (requestedVariant != null && requestedVariant !== "normal") {
    throw new Error(`unknown package runtime variant: ${String(requestedVariant)}`);
  }
  if (!isPlainObject(descriptor?.runtime)) throw new Error("package descriptor has no runtime");
  return { variant: "normal", runtime: descriptor.runtime };
}

export function validatePackageDescriptor(descriptor, { supportedRuntimeTypes = ["html"] } = {}) {
  if (!isPlainObject(descriptor) || descriptor.schema !== PACKAGE_DESCRIPTOR_SCHEMA || !GAME_ID.test(descriptor.game || "") ||
      typeof descriptor.revision !== "string" || !REVISION.test(descriptor.revision)) {
    throw new Error("invalid package descriptor header");
  }

  if (!isPlainObject(descriptor.files) || Object.keys(descriptor.files).length === 0) {
    throw new Error("package descriptor has no files");
  }
  for (const [id, file] of Object.entries(descriptor.files)) {
    if (!FILE_ID.test(id) || !isPlainObject(file) || typeof file.revision !== "string" || !REVISION.test(file.revision)) {
      throw new Error(`invalid package file: ${id}`);
    }
    assertRelativeSource(file.source, `file ${id}`);
    assertTarget(file.target, `file ${id}`);
    if (file.bytes != null && (!Number.isInteger(file.bytes) || file.bytes < 0)) throw new Error(`file ${id}: invalid byte length`);
  }
  if (descriptor.runtimeRequirement != null) validateRuntimeRequirement(descriptor.runtimeRequirement, descriptor.files);
  if (descriptor.runtimes != null) {
    if (!isPlainObject(descriptor.runtimes) || Object.keys(descriptor.runtimes).length === 0 ||
        typeof descriptor.defaultRuntime !== "string" || !Object.hasOwn(descriptor.runtimes, descriptor.defaultRuntime)) {
      throw new Error("invalid package runtime variants descriptor");
    }
    for (const [variant, runtime] of Object.entries(descriptor.runtimes)) {
      if (!RUNTIME_VARIANT.test(variant)) throw new Error(`invalid package runtime variant: ${variant}`);
      validateRuntime(runtime, descriptor.files, supportedRuntimeTypes, `runtime ${variant}`);
    }
    if (descriptor.runtime != null) throw new Error("package descriptor cannot mix runtime and runtimes");
  } else if (descriptor.runtime != null) {
    if (descriptor.defaultRuntime != null) throw new Error("defaultRuntime requires runtime variants");
    validateRuntime(descriptor.runtime, descriptor.files, supportedRuntimeTypes, "package runtime");
  } else {
    if (descriptor.defaultRuntime != null) throw new Error("defaultRuntime requires runtime variants");
    if (descriptor.runtimeRequirement == null) throw new Error("package descriptor has no runtime requirement");
  }

  if (!isPlainObject(descriptor.base)) throw new Error("invalid package base descriptor");
  assertFileRefs(descriptor.base.files, descriptor.files, "base");
  const baseFiles = new Set(descriptor.base.files);
  const runtimes = descriptor.runtimes || (descriptor.runtime ? { normal: descriptor.runtime } : {});
  for (const [variant, runtime] of Object.entries(runtimes)) {
    for (const fileId of runtime.bootstrap || [runtime.entry]) {
      if (!baseFiles.has(fileId)) throw new Error(`runtime ${variant} bootstrap file is not in base: ${fileId}`);
    }
  }

  if (!isPlainObject(descriptor.components)) throw new Error("invalid package components descriptor");
  for (const [id, component] of Object.entries(descriptor.components)) {
    if (!COMPONENT_ID.test(id) || !isPlainObject(component) || typeof component.type !== "string" || !COMPONENT_ID.test(component.type)) {
      throw new Error(`invalid package component: ${id}`);
    }
    if (component.files != null) assertFileRefs(component.files, descriptor.files, `component ${id}`);
    if (component.entries != null) {
      if (!Array.isArray(component.entries)) throw new Error(`component ${id}: entries must be an array`);
      const entryIds = new Set();
      for (const entry of component.entries) {
        if (!isPlainObject(entry) || typeof entry.id !== "string" || !FILE_ID.test(entry.id) || entryIds.has(entry.id) ||
            typeof entry.file !== "string" || !Object.hasOwn(descriptor.files, entry.file)) {
          throw new Error(`component ${id}: invalid entry`);
        }
        if (entry.title != null && typeof entry.title !== "string") throw new Error(`component ${id}: invalid entry title`);
        entryIds.add(entry.id);
      }
    }
  }
  return descriptor;
}

function canonicalValue(value) {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (!isPlainObject(value)) return value;
  return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonicalValue(value[key])]));
}

export function canonicalPackagePayload(descriptor) {
  const copy = { ...descriptor };
  delete copy.revision;
  return JSON.stringify(canonicalValue(copy));
}

export function resolvePackageSource(descriptorUrl, source) {
  assertRelativeSource(source, "package source");
  return new URL(source, descriptorUrl).href;
}
