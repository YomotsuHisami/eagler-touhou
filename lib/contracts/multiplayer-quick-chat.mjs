import { loadCompiledContract } from "./load-compiled-contract.mjs";

const contract = await loadCompiledContract("multiplayer-quick-chat");
export const { QUICK_CHAT_PHRASES, quickChatPhrase } = contract;
