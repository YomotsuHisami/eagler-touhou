import { loadCompiledContract } from './load-compiled-contract.mjs';
const contract = await loadCompiledContract('character-art');
export const { CHARACTER_ART_SCHEMA, CHARACTER_ART, CHARACTER_ART_IDS, TH09_CHARACTER_ART,
  CHARACTER_TEAMS, characterArtForName, defaultCharacterArt } = contract;
