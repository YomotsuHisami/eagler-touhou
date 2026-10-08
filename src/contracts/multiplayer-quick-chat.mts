export interface QuickChatPhrase { readonly id: string; readonly zh: string; readonly en: string }

// The relay and UI share canonical IDs. Clients never submit arbitrary text or
// a claimed sender name.
export const QUICK_CHAT_ROWS: readonly (readonly QuickChatPhrase[])[] = Object.freeze([
  [{ id: "1", zh: "1", en: "1" }],
  [{ id: "request-life", zh: "请求给条命（停止开火，然后在我旁边低速即可）", en: "Life please (stop firing, then focus next to me)" }],
  [{ id: "request-power", zh: "请求给 Power（在我身旁快速按多下开火键即可）", en: "Power please (tap fire repeatedly next to me)" }],
  [{ id: "share-resources", zh: "请均分资源", en: "Please share resources evenly" }],
  [{ id: "follow-me", zh: "跟着我", en: "Follow me" }, { id: "spread-out", zh: "分开走", en: "Spread out" }],
  [{ id: "stop-fire", zh: "停枪", en: "Stop firing" }],
  [{ id: "bomb-me", zh: "我开 Bomb", en: "I'll use Bomb" }, { id: "bomb-you", zh: "你开 Bomb", en: "You use Bomb" }],
  [{ id: "leaving", zh: "退了", en: "I'm leaving" }],
  [{ id: "last-game", zh: "最后一局吧", en: "One last game?" }, { id: "last", zh: "last", en: "last" }],
  [{ id: "thanks", zh: "谢谢指教", en: "Thanks for the games" }, { id: "xxzj", zh: "xxzj", en: "xxzj" }],
]);

export const QUICK_CHAT_PHRASES: readonly QuickChatPhrase[] = Object.freeze(QUICK_CHAT_ROWS.flat());

export function quickChatPhrase(id: unknown): QuickChatPhrase | undefined {
  return typeof id === "string" ? QUICK_CHAT_PHRASES.find(phrase => phrase.id === id) : undefined;
}
