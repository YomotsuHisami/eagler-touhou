// Opaque room-invite token for the launcher URL. A multiplayer room link needs
// to carry the product, room code, the "came from lobby" marker, the create/join
// intent, and (for a fresh room) its initial settings. Exposing all of those as
// plain query parameters (game=th06mp&mpRoom=4079&room=4079&fromLobby=1&...) is
// noisy and leaks the transport shape into the address bar. We fold the whole
// payload into a single base64url token behind the `j` query key instead.

export const ROOM_INVITE_KEY = "j";

export interface RoomInvite {
  /** Multiplayer product id, e.g. "th06mp". */
  g: string;
  /** Room code, 4-8 digits. */
  r: string;
  /** The session entered via the lobby directory (return there on leave). */
  f?: boolean;
  /** create | join intent carried by the originating directory navigation. */
  a?: "create" | "join";
  /** Initial player count for a freshly created room. */
  p?: number;
  /** Initial difficulty for a freshly created room. */
  d?: number;
  /** Initial visibility for a freshly created room. */
  v?: "public" | "private";
  /** Initial disable-cheat-movement flag for a freshly created room. */
  c?: boolean;
}

function toBase64Url(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(value: string): string {
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64.length % 4 === 0 ? base64 : base64 + "=".repeat(4 - (base64.length % 4));
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
  return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
}

export function encodeRoomInvite(invite: RoomInvite): string {
  const payload: Record<string, unknown> = { g: invite.g, r: invite.r };
  if (invite.f) payload.f = true;
  if (invite.a) payload.a = invite.a;
  if (invite.p !== undefined) payload.p = invite.p;
  if (invite.d !== undefined) payload.d = invite.d;
  if (invite.v) payload.v = invite.v;
  if (invite.c) payload.c = true;
  return toBase64Url(JSON.stringify(payload));
}

export function decodeRoomInvite(token: string): RoomInvite | null {
  try {
    const parsed = JSON.parse(fromBase64Url(token)) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    const record = parsed as Record<string, unknown>;
    const g = typeof record.g === "string" ? record.g : "";
    const r = typeof record.r === "string" ? record.r : "";
    if (!g || !r) return null;
    return {
      g,
      r,
      f: record.f === true,
      a: record.a === "create" || record.a === "join" ? record.a : undefined,
      p: typeof record.p === "number" ? record.p : undefined,
      d: typeof record.d === "number" ? record.d : undefined,
      v: record.v === "public" || record.v === "private" ? record.v : undefined,
      c: record.c === true,
    };
  } catch {
    return null;
  }
}

export function roomInviteFromUrl(source: string | URL): RoomInvite | null {
  const token = new URL(source).searchParams.get(ROOM_INVITE_KEY);
  return token ? decodeRoomInvite(token) : null;
}
