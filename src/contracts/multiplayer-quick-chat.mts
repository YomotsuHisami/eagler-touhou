export interface QuickChatPhrase { readonly id: string; readonly zh: string; readonly en: string }

// Populate only after the wording has been chosen. The relay and UI use the
// same IDs, so clients never submit arbitrary text or a claimed sender name.
export const QUICK_CHAT_PHRASES: readonly QuickChatPhrase[] = Object.freeze([
  { id: "1", zh: "1", en: "1" },
]);
export function quickChatPhrase(id: unknown): QuickChatPhrase | undefined {
  return typeof id === "string" ? QUICK_CHAT_PHRASES.find(phrase => phrase.id === id) : undefined;
}
