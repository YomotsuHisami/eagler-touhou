import { loadCompiledContract } from "./load-compiled-contract.mjs";

const contract = await loadCompiledContract("product-catalog");
export const {
  HOST_PROTOCOL,
  PRODUCT_FEATURE_POLICY,
  PRODUCT_FEATURE_IDS,
  HOST_RUNTIME_FEATURE_IDS,
  PRODUCT_GAMES,
  PRODUCT_IDS,
  DEFAULT_PRODUCT_ID,
  DEFAULT_MULTIPLAYER_PRODUCT_ID,
  createLocalProductManifest,
  gameIdForProduct,
  isGameId,
  isHostRuntimeFeatureId,
  isMultiplayerProductId,
  isProductId,
  languagePriority,
  multiplayerConfigForProduct,
  multiplayerInputTimingPolicy,
  multiplayerProductIdForGame,
  productFeatureAvailable,
  productEnabledForBuild,
} = contract;
