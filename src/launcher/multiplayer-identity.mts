export const multiplayerDisplayNameStorageKey = "eagler-touhou-mp-display-name-v1";
export function multiplayerControlMode(value: unknown): "normal" | "touch" | "cheat" | null {
  return value === "normal" || value === "touch" || value === "cheat" ? value : null;
}
export const multiplayerDisplayNameLockedStorageKey = "eagler-touhou-mp-display-name-locked-v1";
export const multiplayerLobbyClientStorageKey = (product: string): string =>
  `eagler-touhou-${product}-lobby-client-v1`;

// A browser membership spans titles and tabs; the existing client id still
// belongs to a single tab. No name or account information is used here.
let rememberedMemberId = "";
export function multiplayerMemberId(): string {
  if (rememberedMemberId) return rememberedMemberId;
  const key = "eagler-touhou-mp-member-v1";
  try {
    const saved = localStorage.getItem(key);
    if (validMultiplayerClientId(saved)) return rememberedMemberId = saved;
  } catch {}
  const words = new Uint32Array(4);
  // Membership also authorizes room transports. Fail closed if cryptographic
  // randomness is unavailable rather than minting a predictable credential.
  crypto.getRandomValues(words);
  rememberedMemberId = `m${Array.from(words, n => n.toString(36).padStart(7, "0")).join("")}`;
  try { localStorage.setItem(key, rememberedMemberId); } catch {}
  return rememberedMemberId;
}

export interface MultiplayerIdentityStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export function normalizeMultiplayerDisplayName(value: unknown): string {
  // Strip all Unicode Bidi_Control characters and the existing invisible
  // controls before trimming/counting, so avatar initials stay visible too.
  return [...String(value || "").replace(/[\u0000-\u001f\u007f\u061c\u200b-\u200f\u202a-\u202e\u2060-\u2064\u2066-\u2069\ufeff]/g, "").trim()].slice(0, 12).join("");
}

export function multiplayerDisplayInitial(name: unknown, fallback = "观"): string {
  return [...normalizeMultiplayerDisplayName(name)][0] || fallback;
}

export function validMultiplayerClientId(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9_-]{8,64}$/.test(value);
}

export interface MultiplayerIdentityStore {
  loadDisplayName(): string;
  updateDisplayName(value: unknown, fallbackName?: string): { updated: boolean; name: string };
  lobbyClientId(product: string): string;
}

function browserStorage(name: "localStorage" | "sessionStorage"): MultiplayerIdentityStorage | null {
  try { return globalThis[name] as MultiplayerIdentityStorage; }
  catch { return null; }
}

export function createMultiplayerIdentityStore({
  persistentStorage = browserStorage("localStorage"),
  sessionStorage = browserStorage("sessionStorage"),
  randomWords = () => {
    const words = new Uint32Array(2);
    globalThis.crypto.getRandomValues(words);
    return [words[0], words[1]] as const;
  },
  fallbackClientId = () => `c${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`,
}: {
  persistentStorage?: MultiplayerIdentityStorage | null;
  sessionStorage?: MultiplayerIdentityStorage | null;
  randomWords?: () => readonly [number, number];
  fallbackClientId?: () => string;
} = {}): MultiplayerIdentityStore {
  const loadDisplayName = (): string => {
    if (!persistentStorage) return "";
    try {
      const name = normalizeMultiplayerDisplayName(persistentStorage.getItem(multiplayerDisplayNameStorageKey) || "");
      if (name) persistentStorage.setItem(multiplayerDisplayNameLockedStorageKey, "1");
      return name;
    } catch {
      return "";
    }
  };

  // Names are editable at any time. The locked marker is still written as a
  // compatibility record that a name has been stored; an empty edit falls
  // back to the name already in effect so a nickname is never cleared.
  const updateDisplayName = (value: unknown, fallbackName = ""): { updated: boolean; name: string } => {
    const name = normalizeMultiplayerDisplayName(value) || normalizeMultiplayerDisplayName(fallbackName);
    if (!name) return { updated: false, name };
    try {
      persistentStorage?.setItem(multiplayerDisplayNameStorageKey, name);
      persistentStorage?.setItem(multiplayerDisplayNameLockedStorageKey, "1");
    } catch {}
    return { updated: true, name };
  };

  // Session storage persists across reloads; memory is the authority within
  // this document, including when storage is absent or a write fails.
  const clientIds = new Map<string, string>();
  const rememberClientId = (product: string, value: string): string => {
    clientIds.set(product, value);
    return value;
  };
  const lobbyClientId = (product: string): string => {
    const remembered = clientIds.get(product);
    if (remembered) return remembered;
    const key = multiplayerLobbyClientStorageKey(product);
    try {
      const existing = sessionStorage?.getItem(key) || "";
      if (validMultiplayerClientId(existing)) return rememberClientId(product, existing);
      const [first, second] = randomWords();
      const value = `c${first.toString(36).padStart(7, "0")}${second.toString(36).padStart(7, "0")}`;
      rememberClientId(product, value);
      sessionStorage?.setItem(key, value);
      return value;
    } catch {
      return clientIds.get(product) || rememberClientId(product, fallbackClientId());
    }
  };

  return Object.freeze({ loadDisplayName, updateDisplayName, lobbyClientId });
}
