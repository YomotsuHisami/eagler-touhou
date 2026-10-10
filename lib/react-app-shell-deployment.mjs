/** Shared artifact policy. This module never registers a Service Worker. */
export const REACT_APP_SHELL_META = "eagler-react-app-shell";

export function normalizeReactMountPath(value) {
  if (typeof value !== "string" || !/^\/(?:[A-Za-z0-9_-]+\/)*$/.test(value)) throw new Error("React mount must be an absolute directory path with a trailing slash");
  return value;
}

export function validateReactAppShellDeployment(value) {
  if (!value || typeof value !== "object") throw new Error("Missing isolated React App Shell configuration");
  if (value.schema !== "eagler-touhou/react-app-shell/1" || typeof value.origin !== "string" || typeof value.mountPath !== "string") throw new Error("Invalid isolated React App Shell configuration");
  const origin = new URL(value.origin), mountPath = normalizeReactMountPath(value.mountPath);
  const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(origin.hostname);
  if (origin.origin !== value.origin || origin.username || origin.password || (origin.protocol !== "https:" && !(origin.protocol === "http:" && loopback))) throw new Error("An exact secure deployment origin is required");
  // A remote experiment must remain explicitly isolated from a production root.
  if (mountPath === "/" && !loopback) throw new Error("A remote React experiment requires an isolated non-root mount");
  return Object.freeze({schema: /** @type {const} */ ("eagler-touhou/react-app-shell/1"), origin: origin.origin, mountPath});
}
