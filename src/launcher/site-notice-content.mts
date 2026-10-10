export const SITE_NOTICE_DURATION_MS = 15_000;
export const SITE_NOTICE_STORAGE_KEY = "eagler-touhou-site-notice-enabled-v1";
export const SITE_NOTICE_DISMISSED_KEY = "eagler-touhou-site-notice-dismissed-v1";

export type SiteNoticeSegment =
  | Readonly<{ type: "text"; text: string }>
  | Readonly<{
      type: "link";
      label: string;
      href: string;
      resolvedHref: string;
      external: boolean;
      asset: string;
    }>;

export type SiteNoticeLine = ReadonlyArray<SiteNoticeSegment>;

export function fallbackBaseUrl(): string {
  try { return globalThis.location?.href || "https://notice.invalid/"; }
  catch { return "https://notice.invalid/"; }
}

export function siteNoticeBrandAsset(url: string, baseUrl = fallbackBaseUrl()): string {
  const resolved = new URL(url, baseUrl);
  const base = new URL(baseUrl);
  const host = resolved.hostname.toLowerCase();
  if (host === "cloud.touhou.best") return "assets/notice-touhou-cloud.png";
  if (host === "qm.qq.com") return "assets/notice-qq.svg";
  if (host === "github.com") return "assets/notice-github.svg";
  if (host === "bilibili.com" || host.endsWith(".bilibili.com")) return "assets/notice-bilibili.svg";
  if (resolved.origin === base.origin && /(?:^|\/)faq\.html$/i.test(resolved.pathname)) return "assets/th06.ico";
  return "";
}

function parseSiteNoticeLine(line: string, baseUrl: string): SiteNoticeLine {
  const segments: SiteNoticeSegment[] = [];
  const linkPattern = /\[([^\]]+)\]\(([^\s)]+)\)/g;
  const base = new URL(baseUrl);
  let cursor = 0;
  for (const match of line.matchAll(linkPattern)) {
    const index = match.index ?? 0;
    let resolved: URL;
    try { resolved = new URL(match[2], base); } catch { continue; }
    if (resolved.protocol !== "http:" && resolved.protocol !== "https:") continue;
    if (index > cursor) segments.push(Object.freeze({ type: "text", text: line.slice(cursor, index) }));
    segments.push(Object.freeze({
      type: "link",
      label: match[1],
      href: match[2],
      resolvedHref: resolved.href,
      external: resolved.origin !== base.origin,
      asset: siteNoticeBrandAsset(resolved.href, base.href),
    }));
    cursor = index + match[0].length;
  }
  if (cursor < line.length) segments.push(Object.freeze({ type: "text", text: line.slice(cursor) }));
  return Object.freeze(segments);
}

export function parseSiteNoticeText(text: string, baseUrl = fallbackBaseUrl()): ReadonlyArray<SiteNoticeLine> {
  return Object.freeze(text
    .split(/\r?\n/)
    .map(value => value.trim())
    .filter(Boolean)
    .map(line => parseSiteNoticeLine(line, baseUrl)));
}

