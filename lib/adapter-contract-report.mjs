import { PRODUCT_GAMES, isGameId } from "./contracts/product-catalog.mjs";
import {
  REQUIRED_ADAPTER_CAPABILITIES,
  REQUIRED_INPUT_BEHAVIORS,
  REQUIRED_TOUCH_BEHAVIORS,
  REQUIRED_PRESENTATION_BEHAVIORS,
  REQUIRED_REPLAY_BEHAVIORS,
  REQUIRED_REPLAY_VERIFICATION_BEHAVIORS,
  REQUIRED_STORAGE_BEHAVIORS,
  REQUIRED_MUSIC_BEHAVIORS,
  REQUIRED_PACKAGE_BEHAVIORS,
  REQUIRED_MULTIPLAYER_BEHAVIORS,
  REQUIRED_THPRAC_BEHAVIORS,
  REQUIRED_LANGUAGE_BEHAVIORS,
  REQUIRED_MIDI_BEHAVIORS,
  GAME_OPTION_CLASSIFICATION,
  INHERITED_LAUNCHER_CAPABILITIES,
  PROFILE_REQUIRED_CAPABILITIES,
  OPTIONAL_PRODUCT_CAPABILITIES,
  IMPLEMENTATION_DETAILS,
  FORMAT_ADAPTERS,
  COMPATIBILITY_ADAPTERS,
} from "./contracts/adapter-capabilities.mjs";
import {
  RUNTIME_CONFIGURE_LEGACY_OPTION_KEYS,
  RUNTIME_CONFIGURE_LEGACY_MUSIC_MODES,
  RUNTIME_PROTOCOL_LEGACY_EVENTS,
  RUNTIME_CONFIGURE_OPTION_BEHAVIOR,
  RUNTIME_PROTOCOL_COMMAND_BEHAVIOR,
  RUNTIME_PROTOCOL_EVENT_BEHAVIOR,
} from "./contracts/runtime-protocol.mjs";
import { PRODUCT_CONTENT } from "./content-definition.mjs";
import { runtimeAdapterProfile } from "./runtime-data-provider.mjs";

export const ADAPTER_CONTRACT_REPORT_SCHEMA = "eagler-touhou/adapter-contract-report/1";

function declarationValue(product, declaration) {
  if (!/^[A-Za-z][A-Za-z0-9]*(?:\.[A-Za-z][A-Za-z0-9]*)*$/.test(declaration)) {
    throw new Error(`optional capability declaration is not a product path: ${declaration}`);
  }
  return declaration.split(".").reduce((value, key) =>
    value && typeof value === "object" ? value[key] : undefined, product);
}

function capabilityActive(optional, capability) {
  if (Object.hasOwn(optional, capability)) return optional[capability] === true;
  const profile = PROFILE_REQUIRED_CAPABILITIES.find(item => item.id === capability);
  return profile ? optional[profile.when] === true : false;
}

function configureOptionReport(optional, behavior, product) {
  const activeForProduct = behavior.requirement === "required"
    ? true
    : behavior.requirement === "diagnostic"
      ? false
      : capabilityActive(optional, behavior.capability) &&
        (!behavior.productDeclaration || declarationValue(product, behavior.productDeclaration) === true);
  return { ...behavior, activeForProduct };
}

const cloneDefinitions = items => items.map(item => ({ ...item }));

export function createAdapterContractReport(game) {
  if (!isGameId(game)) throw new Error(`unknown game: ${game}`);
  const product = PRODUCT_GAMES[game];
  const content = PRODUCT_CONTENT[game] || {};
  const optional = Object.fromEntries(OPTIONAL_PRODUCT_CAPABILITIES.map(item => [item.id, !!declarationValue(product, item.declaration)]));
  return Object.freeze({
    schema: ADAPTER_CONTRACT_REPORT_SCHEMA,
    game,
    product: Object.freeze({
      title: product.title,
      subtitle: product.subtitle,
      cardArtwork: product.cardArtwork,
      cardPresentation: product.cardPresentation || null,
      sourceRepository: product.support.sourceRepository,
      runtime: product.runtime,
      multiplayerRuntime: product.multiplayerRuntime || null,
      multiplayer: product.multiplayer || null,
      runtimeFileLayout: product.runtimeFileLayout || "flat",
      runtimeAssets: product.runtimeAssets || null,
      requiredShared: product.requiredShared || [],
      adapterProfile: runtimeAdapterProfile(game),
      dataFileId: product.package.dataFileId,
      dataTarget: product.package.dataTarget,
      storage: product.storage,
      replay: product.replay,
      music: Object.freeze({
        normalOggRequired: true,
        noneRequired: true,
        midiOptional: product.musicCapabilities.midi === true,
        mounts: product.package.musicMounts || {},
      }),
      originalContent: content.original || null,
      hostPreparation: content.hostPreparation || null,
      activeFormatPreparation: Object.freeze({
        artwork: content.hostPreparation?.artwork?.kind || null,
        ogg: content.hostPreparation?.ogg?.kind || null,
        languagePack: content.hostPreparation?.languagePack?.kind || null,
        dataAssets: content.hostPreparation?.dataAssets?.kind || null,
        preparedContent: content.hostPreparation?.preparedContent
          ? Object.freeze({
              directory: content.hostPreparation.preparedContent.directory,
              script: content.hostPreparation.preparedContent.script,
            })
          : null,
      }),
    }),
    obligations: Object.freeze({
      required: REQUIRED_ADAPTER_CAPABILITIES.map(item => item.id),
      requiredDefinitions: cloneDefinitions(REQUIRED_ADAPTER_CAPABILITIES),
      inherited: INHERITED_LAUNCHER_CAPABILITIES.map(item => item.id),
      inheritedDefinitions: cloneDefinitions(INHERITED_LAUNCHER_CAPABILITIES),
      inputProfile: REQUIRED_INPUT_BEHAVIORS.map(item => item.id),
      touchProfile: REQUIRED_TOUCH_BEHAVIORS.map(item => item.id),
      presentationProfile: REQUIRED_PRESENTATION_BEHAVIORS.map(item => item.id),
      replayProfile: REQUIRED_REPLAY_BEHAVIORS.map(item => item.id),
      replayVerificationProfile: REQUIRED_REPLAY_VERIFICATION_BEHAVIORS.map(item => item.id),
      storageProfile: REQUIRED_STORAGE_BEHAVIORS.map(item => item.id),
      musicProfile: REQUIRED_MUSIC_BEHAVIORS.map(item => item.id),
      packageProfile: REQUIRED_PACKAGE_BEHAVIORS.map(item => item.id),
      requiredBehaviorDefinitions: Object.freeze({
        input: cloneDefinitions(REQUIRED_INPUT_BEHAVIORS),
        touch: cloneDefinitions(REQUIRED_TOUCH_BEHAVIORS),
        presentation: cloneDefinitions(REQUIRED_PRESENTATION_BEHAVIORS),
        replay: cloneDefinitions(REQUIRED_REPLAY_BEHAVIORS),
        replayVerification: cloneDefinitions(REQUIRED_REPLAY_VERIFICATION_BEHAVIORS),
        storage: cloneDefinitions(REQUIRED_STORAGE_BEHAVIORS),
        music: cloneDefinitions(REQUIRED_MUSIC_BEHAVIORS),
        package: cloneDefinitions(REQUIRED_PACKAGE_BEHAVIORS),
      }),
      optionalProfiles: Object.freeze({
        multiplayer: Object.freeze({ active: optional.multiplayer === true, behaviors: REQUIRED_MULTIPLAYER_BEHAVIORS.map(item => item.id), behaviorDefinitions: cloneDefinitions(REQUIRED_MULTIPLAYER_BEHAVIORS) }),
        thprac: Object.freeze({ active: optional.thprac === true, behaviors: REQUIRED_THPRAC_BEHAVIORS.map(item => item.id), behaviorDefinitions: cloneDefinitions(REQUIRED_THPRAC_BEHAVIORS) }),
        languages: Object.freeze({ active: optional.languages === true, behaviors: REQUIRED_LANGUAGE_BEHAVIORS.map(item => item.id), behaviorDefinitions: cloneDefinitions(REQUIRED_LANGUAGE_BEHAVIORS) }),
        midi: Object.freeze({ active: optional["midi-music"] === true, behaviors: REQUIRED_MIDI_BEHAVIORS.map(item => item.id), behaviorDefinitions: cloneDefinitions(REQUIRED_MIDI_BEHAVIORS) }),
      }),
      optionalProductCapabilities: optional,
      optionalProductCapabilityDefinitions: cloneDefinitions(OPTIONAL_PRODUCT_CAPABILITIES),
      activeProfileRequired: PROFILE_REQUIRED_CAPABILITIES.filter(item => optional[item.when] === true).map(item => item.id),
      activeProfileRequiredDefinitions: PROFILE_REQUIRED_CAPABILITIES.filter(item => optional[item.when] === true).map(item => ({ ...item })),
    }),
    protocol: Object.freeze({
      gameOptions: Object.fromEntries(Object.entries(GAME_OPTION_CLASSIFICATION)
        .map(([key, value]) => [key, { ...value }])),
      configureOptions: Object.fromEntries(Object.entries(RUNTIME_CONFIGURE_OPTION_BEHAVIOR)
        .map(([key, value]) => [key, configureOptionReport(optional, value, product)])),
      legacyConfigureAliases: [...RUNTIME_CONFIGURE_LEGACY_OPTION_KEYS],
      legacyMusicModes: [...RUNTIME_CONFIGURE_LEGACY_MUSIC_MODES],
      legacyEvents: [...RUNTIME_PROTOCOL_LEGACY_EVENTS],
      commands: Object.fromEntries(Object.entries(RUNTIME_PROTOCOL_COMMAND_BEHAVIOR).map(([key, value]) => [key, { ...value }])),
      events: Object.fromEntries(Object.entries(RUNTIME_PROTOCOL_EVENT_BEHAVIOR).map(([key, value]) => [key, { ...value }])),
    }),
    nonObligations: Object.freeze({
      implementationDetails: IMPLEMENTATION_DETAILS.map(item => item.id),
      implementationDetailDefinitions: cloneDefinitions(IMPLEMENTATION_DETAILS),
      formatAdapters: FORMAT_ADAPTERS.map(item => item.id),
      formatAdapterDefinitions: cloneDefinitions(FORMAT_ADAPTERS),
      compatibilityAdapters: COMPATIBILITY_ADAPTERS.map(item => item.id),
      compatibilityAdapterDefinitions: cloneDefinitions(COMPATIBILITY_ADAPTERS),
    }),
  });
}
