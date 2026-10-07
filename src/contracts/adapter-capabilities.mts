export type AdapterCapabilityClass = "required" | "inherited" | "profile-required" | "optional" | "implementation-detail" | "format-adapter" | "compatibility";

export interface AdapterCapabilityDefinition {
  readonly id: string;
  readonly class: AdapterCapabilityClass;
  readonly owner: "launcher-runtime" | "launcher" | "product" | "runtime" | "maintainer" | "format" | "legacy";
  readonly declaration?: string;
  readonly when?: string;
  readonly verification?: readonly string[];
  readonly summary: string;
}

// This table answers a deliberately different question from PRODUCT_GAMES:
// "must a new game implement this at all?" Required capabilities are not
// product booleans and may not be disabled to make an incomplete adapter pass.
export const REQUIRED_ADAPTER_CAPABILITIES = Object.freeze([
  { id: "authoritative-gameplay-fidelity", class: "required", owner: "runtime",
    verification: ["runtime:per-game original-behavior and Replay/determinism gates"],
    summary: "authoritative gameplay, collision, RNG, timers and native menu/state-machine semantics follow the original title unless an explicit Eagler Touhou product contract says otherwise" },
  { id: "runtime-lifecycle", class: "required", owner: "launcher-runtime",
    verification: ["repository:tests/test-runtime-protocol-model.mjs", "workspace:tests/test-runtime-protocol-contract.mjs", "workspace:tests/test-shell-protocol.mjs"],
    summary: "ready/configure/launch/first-frame/exit/error lifecycle and request-response semantics" },
  { id: "keyboard-input", class: "required", owner: "launcher-runtime",
    verification: ["workspace:tests/test-runtime-protocol-contract.mjs", "workspace:tests/test-shell-protocol.mjs"],
    summary: "keyboard transitions plus held-key cleanup" },
  { id: "gamepad-input", class: "required", owner: "launcher-runtime",
    verification: ["workspace:tests/test-gamepad-contract.mjs", "runtime:per-game controller/input gates"],
    summary: "physical gamepad buttons, D-pad/axes and disconnect-safe controller polling feed the title's normal logical input path" },
  { id: "touch-controls", class: "required", owner: "launcher-runtime",
    verification: ["repository:tests/test-touch-runtime-protocol.mjs", "workspace:tests/test-runtime-protocol-contract.mjs", "workspace:tests/test-portable-touch-controller-contract.mjs", "runtime:per-game touch/deathbomb/outside-touch gates"],
    summary: "touch controls, direct touch, cancellation and the shared sensitivity contract; touch resolves to the same authoritative input/Replay semantics as keyboard/controller" },
  { id: "restart-action", class: "required", owner: "launcher-runtime",
    verification: ["workspace:tests/test-required-gameplay-actions.mjs"],
    summary: "the shared Restart control maps R to the title's restart-current-run action while the pause UI owns input" },
  { id: "always-hitbox", class: "required", owner: "launcher-runtime",
    verification: ["workspace:tests/test-always-hitbox-contract.mjs", "runtime:per-game visual regression"],
    summary: "keep the title's native/native-equivalent focus-hitbox visual visible without changing authoritative focus, movement or collision state" },
  { id: "visibility-input-cleanup", class: "required", owner: "launcher-runtime",
    verification: ["workspace:tests/test-shell-protocol.mjs", "runtime:per-game outside-touch/visibility gates"],
    summary: "blur/visibility/pagehide must not leave input or transient touch ownership stuck" },
  { id: "runtime-health-diagnostics", class: "required", owner: "launcher-runtime",
    verification: ["workspace:tests/test-runtime-protocol-contract.mjs", "workspace:tests/test-shell-protocol.mjs", "repository:tests/test-runtime-diagnostics-model.mjs"],
    summary: "runtime identity plus periodic frame/audio health diagnostics used by the shared diagnostics UI" },
  { id: "durable-storage", class: "required", owner: "launcher-runtime",
    verification: ["workspace:tests/test-runtime-storage-contract.mjs", "browser:tests/test-runtime-storage-conformance.py", "runtime:directory Runtime storage gates"],
    summary: "save/config state survives sync, Runtime restart and offline installed-game launch" },
  { id: "replay-file-management", class: "required", owner: "launcher-runtime",
    verification: ["repository:tests/test-replay-files.mjs", "workspace:tests/test-replay-extension-contract.mjs", "runtime:per-game Replay compatibility gates"],
    summary: "Replay list/read/write/remove/sync surface and original-compatible import/export" },
  { id: "replay-determinism-verification", class: "required", owner: "runtime",
    verification: ["runtime:per-game quick/daily/oracle Replay verifier gates"],
    summary: "the title repository owns fixed-tick Demo and long-Replay equivalence gates backed by immutable original-derived golden traces, with oracle regeneration isolated as explicit maintenance" },
  { id: "normal-music-ogg", class: "required", owner: "launcher-runtime",
    verification: ["repository:tests/test-music-availability.mjs", "browser:tests/browser/test-music-selection.py", "runtime:per-game OGG/audio gates"],
    summary: "normal game music is available through the OGG path; no-music mode is also supported" },
  { id: "presentation-cadence", class: "required", owner: "launcher-runtime",
    verification: ["workspace:tests/test-mobile-frame-pacing.mjs", "workspace:tests/test-native-frame-pacing.mjs", "workspace:tests/test-presentation-contract-coverage.mjs", "runtime:per-game presentation-purity/high-refresh gates"],
    summary: "present at display cadence above the title's authoritative update rate while never advancing gameplay, Replay, RNG, timers or saves from extra display frames" },
  { id: "package-offline-launch", class: "required", owner: "launcher-runtime",
    verification: ["repository:tests/test-package-store-contract.mjs", "repository:tests/test-offline-publication.mjs", "browser:tests/test-offline-reload-browser.py"],
    summary: "canonical Package Store install plus reload/offline launch of installed DATA" },
] satisfies readonly AdapterCapabilityDefinition[]);

export interface RequiredTouchBehavior {
  readonly id: string;
  readonly owner: "launcher-runtime" | "launcher";
  readonly summary: string;
}

export interface RequiredPresentationBehavior {
  readonly id: string;
  readonly summary: string;
}

export interface RequiredReplayBehavior {
  readonly id: string;
  readonly summary: string;
}

export interface RequiredReplayVerificationBehavior {
  readonly id: string;
  readonly summary: string;
}

export interface RequiredCoreBehavior {
  readonly id: string;
  readonly summary: string;
}

// Keyboard/gamepad/touch are different physical sources, not different game
// semantics. These rules cover the shared input boundary outside the more
// detailed touch profile below.
export const REQUIRED_INPUT_BEHAVIORS = Object.freeze([
  { id: "keyboard-logical-input", summary: "keyboard transitions feed the title's ordinary logical input path instead of bypassing its controller/input state machine" },
  { id: "controller-logical-input", summary: "physical gamepad buttons, D-pad and axes feed the same authoritative action/movement semantics used by the title" },
  { id: "independent-input-owners", summary: "releasing/cancelling one physical input source must not clear an equivalent action still held by another source" },
  { id: "loss-cleanup", summary: "blur, visibility loss, pagehide and controller disconnect clear transient ownership so no movement/action remains stuck" },
  { id: "original-menu-semantics", summary: "menu/dialogue input reaches the title's normal navigation/confirm/cancel/skip state machines rather than invoking game-state shortcuts" },
] satisfies readonly RequiredCoreBehavior[]);

// "Touch support" is not satisfied by merely showing buttons. These behaviors
// define the current all-game touch profile. Launcher-owned affordances are
// listed too so an adapter agent knows to reuse them rather than adding another
// game-side API.
export const REQUIRED_TOUCH_BEHAVIORS = Object.freeze([
  { id: "direct-rate-limited-movement", owner: "launcher-runtime", summary: "direct drag follows the player while respecting the title's normal focused/unfocused movement speed relationship" },
  { id: "direct-unlimited-movement", owner: "launcher-runtime", summary: "explicit unlimited direct drag mode follows the requested target without applying normal low-speed rate limiting" },
  { id: "joystick-digital-movement", owner: "launcher-runtime", summary: "virtual joystick can feed the same directional logical input used by keyboard/gamepad" },
  { id: "joystick-free-movement", owner: "launcher-runtime", summary: "free-direction joystick mode can feed analog/direct motion without inventing another simulation clock" },
  { id: "focus-hold", owner: "launcher-runtime", summary: "hold-button focus behaves like holding the normal focus input" },
  { id: "focus-toggle", owner: "launcher-runtime", summary: "toggle-button focus produces the same logical focus state without changing game mechanics" },
  { id: "focus-two-finger", owner: "launcher-runtime", summary: "two-finger focus changes only the input source; normal low-speed/focus gameplay remains authoritative" },
  { id: "fire-bomb-pause", owner: "launcher-runtime", summary: "Fire, Bomb and Escape/Pause resolve to the title's normal logical inputs" },
  { id: "deathbomb-preservation", owner: "launcher-runtime", summary: "touch Bomb preserves the title's original deathbomb window and must not cancel held movement merely because Bomb was consumed" },
  { id: "unlimited-cheat-processing-rate", owner: "launcher-runtime", summary: "only actual non-zero unlimited direct movement marks the run as cheat movement; once used, Result/high-score and saved-Replay processing-drop metadata use the product-defined 100 percent value" },
  { id: "double-tap-bomb", owner: "launcher-runtime", summary: "the shared optional double-tap gesture, when enabled by the user, resolves to the same Bomb input path" },
  { id: "menu-dialogue-navigation", owner: "launcher-runtime", summary: "touch menu/dialogue gestures resolve to ordinary direction/confirm/cancel/skip inputs rather than bypassing menu state machines" },
  { id: "touch-confirm-edge", owner: "launcher-runtime", summary: "a touch confirm on dialogue, StageClear or another modal owner produces a fresh logical edge even when gameplay Fire was held immediately before the modal; multiplayer aggregation must not reintroduce another seat's held Shoot into that owner" },
  { id: "sensitivity-100-300", owner: "launcher-runtime", summary: "touch sensitivity accepts the shared 100–300 percent contract at both Launcher and Runtime boundaries" },
  { id: "mixed-input-isolation", owner: "launcher-runtime", summary: "touch cancellation or mode changes must not release physical/hosted keyboard or gamepad state still held by another input owner" },
  { id: "lifecycle-cancel", owner: "launcher-runtime", summary: "blur, visibility loss, pagehide and pointer cancellation release transient touch ownership without synthesizing gameplay actions" },
  { id: "layout-editor", owner: "launcher", summary: "button placement, scale, orientation profiles and sensitivity UI are inherited from the shared Launcher and must not be reimplemented per game" },
  { id: "restart-button", owner: "launcher", summary: "the shared touch Restart button emits the normal R-key path; the Runtime owes required restart-action semantics, not a touch-specific restart command" },
  { id: "magnifier", owner: "launcher", summary: "pinch/zoom magnification is host viewport behavior and not a game-side touch protocol" },
] satisfies readonly RequiredTouchBehavior[]);

// High refresh is a product capability, not merely permission to render extra
// frames. The concrete interpolation architecture is an implementation detail;
// these are the behavioral boundaries every formal adapter owes.
export const REQUIRED_PRESENTATION_BEHAVIORS = Object.freeze([
  { id: "fixed-authority", summary: "gameplay simulation, input consumption, Replay, RNG, authored timers and save state advance only at the title's authoritative update cadence" },
  { id: "display-cadence-presentation", summary: "when display refresh exceeds the authoritative update rate and the user has not enabled the 60 Hz presentation limit, visible presentation continues at display cadence" },
  { id: "draw-only-extra-frames", summary: "extra presentation frames are side-effect-free and may not run authoritative update/audio-event/save logic" },
  { id: "continuous-fields-only", summary: "interpolation applies only to continuous visual state with explicit owner/lifecycle identity; discrete sprite/state/lifecycle transitions snap" },
  { id: "discontinuity-snap", summary: "spawn, destroy, teleport, scene change and other lifecycle discontinuities render the authoritative current state rather than blending unrelated samples" },
  { id: "pause-modal-policy", summary: "pause/modal presentation may animate UI, but frozen world state must not be advanced by display-rate draws" },
  { id: "first-frame-after-present", summary: "first-frame is acknowledged only after an actual presented frame, never after update-only work" },
  { id: "optional-60hz-presentation-limit", summary: "the shared 60 Hz presentation option limits visible presentation without creating a second simulation model or changing original gameplay cadence" },
] satisfies readonly RequiredPresentationBehavior[]);

// Replay is required for every formal adapter, but its binary/extension
// mechanism is not. These are the behavior-level obligations that EAGX, RPYX
// or any future representation must satisfy.
export const REQUIRED_REPLAY_BEHAVIORS = Object.freeze([
  { id: "original-replay-import", summary: "the Runtime can load and play the title's ordinary original-compatible Replay format" },
  { id: "original-replay-export-when-representable", summary: "recordings whose authoritative input fits the retail format export as ordinary original-compatible Replays" },
  { id: "deterministic-effective-input", summary: "recording captures authoritative effective input after source resolution so keyboard, gamepad and touch do not create different gameplay semantics" },
  { id: "extended-format-only-when-needed", summary: "extra Replay state is used only when authoritative input cannot be represented by the retail format and is explicitly versioned/validated" },
  { id: "file-management", summary: "list/read/write/remove/sync expose only the declared Replay/save namespace and remain durable across Runtime restart" },
  { id: "playback-live-input-isolation", summary: "Replay playback does not accidentally consume live gameplay input except explicit playback/menu controls" },
  { id: "presentation-independence", summary: "display-rate presentation and diagnostics never mutate Replay recording/playback state" },
] satisfies readonly RequiredReplayBehavior[]);

// Replay behavior and Replay verification are separate obligations. The
// Launcher manages files, but the title repository owns gameplay state,
// original-version knowledge and the diagnostic tick boundary. These rules do
// not add Launcher/Runtime wire commands and must stay outside player builds.
export const REQUIRED_REPLAY_VERIFICATION_BEHAVIORS = Object.freeze([
  { id: "quick-all-title-demos", summary: "a quick lane compares every built-in title Demo in the title-owned rotation without changing the retail or candidate Demo mechanism" },
  { id: "daily-long-replay-corpus", summary: "a daily lane compares the title corpus's declared standard loadout on Lunatic and Extra, plus any title-specific additional special difficulty; the usual second-character/second-configuration policy is mapped through the title's real selection model" },
  { id: "immutable-content-addressed-golden", summary: "published original-derived traces bind Replay, original executable/resource, schema, completion and trace identities with content hashes" },
  { id: "candidate-cannot-bless", summary: "ordinary candidate checks are read-only against expected data and cannot generate, replace or bless golden traces" },
  { id: "explicit-oracle-maintenance", summary: "regenerating expected traces from the original executable is a separate advanced operation with explicit review and never runs implicitly in quick or daily checks" },
  { id: "strict-fixed-tick-comparison", summary: "comparison fails closed on identity, lifecycle, missing/extra tick, input, RNG or declared authoritative-state differences and reports the earliest observed divergence without frame shifting" },
  { id: "diagnostic-build-isolation", summary: "candidate observation is read-only and diagnostic-build-only; normal single-player gameplay, built-in Demo behavior and separately compiled multiplayer behavior are not modified to satisfy the verifier" },
  { id: "title-owned-adapter", summary: "each title owns its Replay corpus, state mapping, completion rules and original provider while shared infrastructure may own only game-agnostic trace validation and comparison" },
] satisfies readonly RequiredReplayVerificationBehavior[]);

export const REQUIRED_STORAGE_BEHAVIORS = Object.freeze([
  { id: "declared-save-root", summary: "save/config/Replay files live under the Product Catalog's declared storage root and names rather than an adapter-private browser store" },
  { id: "strict-user-file-allowlist", summary: "browser file commands expose only declared score/config/Replay user files and never arbitrary Runtime filesystem access" },
  { id: "explicit-durable-sync", summary: "writes/removals and game-owned save changes can be explicitly flushed before Runtime teardown or user-file completion" },
  { id: "runtime-restart-durability", summary: "synced score/config/save/Replay state survives Runtime destruction and a fresh Runtime instance" },
  { id: "offline-storage-continuity", summary: "the same durable user state remains available when an already installed game is launched offline" },
  { id: "package-user-data-separation", summary: "immutable installed Package generations and mutable player data have separate owners and one cannot silently replace the other" },
] satisfies readonly RequiredCoreBehavior[]);

export const REQUIRED_MUSIC_BEHAVIORS = Object.freeze([
  { id: "audible-ogg-normal-mode", summary: "the normal OGG selection produces the title's actual game music rather than a silent or placeholder compatibility mode" },
  { id: "explicit-no-music-mode", summary: "the no-music selection starts the game without BGM while leaving unrelated game audio behavior intact" },
  { id: "title-music-lifecycle", summary: "track start/stop/change/fade/pause behavior follows the title's ordinary music lifecycle and ends on Runtime teardown" },
  { id: "foreground-audio-recovery", summary: "background/foreground recovery restores the browser output path without restarting the track, corrupting queued output, or replacing the title's loop/fade/playback state" },
  { id: "music-failure-surfacing", summary: "missing/corrupt/failed required music resources are surfaced through the shared error/health model instead of hanging configure/launch silently" },
  { id: "presentation-audio-independence", summary: "display-rate presentation frames never duplicate authoritative music/sound events or advance audio event state" },
] satisfies readonly RequiredCoreBehavior[]);

export const REQUIRED_PACKAGE_BEHAVIORS = Object.freeze([
  { id: "canonical-package-store", summary: "game DATA/resources install through the shared Package Store rather than a title-private IndexedDB/cache format" },
  { id: "runtime-data-identity", summary: "installed DATA selected for launch matches the Host/Package identity and declared Runtime DATA target/layout" },
  { id: "atomic-current-generation", summary: "an incomplete or failed update cannot become the current installed generation" },
  { id: "local-import-parity", summary: "user-imported Package content enters the same descriptor/generation model as hosted or external acquisition" },
  { id: "offline-installed-launch", summary: "after successful installation, reload/offline launch resolves Runtime and required Package DATA without network dependency" },
  { id: "no-shadow-install-store", summary: "a Runtime adapter does not create a second install/update database that bypasses Package Store ownership" },
] satisfies readonly RequiredCoreBehavior[]);

export interface OptionalProfileBehavior {
  readonly id: string;
  readonly owner: "launcher" | "launcher-runtime" | "runtime" | "host";
  readonly summary: string;
}

// Optional profiles are all-or-nothing at the behavior level. A title may omit
// Multiplayer/thprac/language/MIDI entirely, but once it declares one of those
// capabilities the corresponding behavior list becomes part of Definition of
// Done. This prevents a single Boolean declaration from hiding partial support.
export const REQUIRED_MULTIPLAYER_BEHAVIORS = Object.freeze([
  { id: "dedicated-runtime-variant", owner: "launcher-runtime", summary: "the product publishes a distinct multiplayer Runtime variant rather than mutating the single-player Runtime implicitly" },
  { id: "declared-room-bounds", owner: "launcher", summary: "room player count, difficulty, character and loadout choices are constrained by the product multiplayer declaration rather than title-name checks" },
  { id: "ready-start-synchronization", owner: "launcher-runtime", summary: "all authoritative player seats agree on room configuration/start state before gameplay begins" },
  { id: "deterministic-peer-authority", owner: "runtime", summary: "peer/rollback gameplay derives from deterministic authoritative frame/input state and exposes mismatch diagnostics instead of hiding divergence" },
  { id: "player-input-ownership", owner: "runtime", summary: "each player seat consumes only its assigned authoritative input; local touch/gamepad helpers do not impersonate another seat" },
  { id: "spectator-admission-and-isolation", owner: "launcher-runtime", summary: "spectator role is explicit, follows the room admission policy and never injects authoritative gameplay input" },
  { id: "pause-restart-semantics", owner: "runtime", summary: "multiplayer pause/restart follows the multiplayer state machine and does not silently fall back to a host-side page reset" },
  { id: "multiplayer-replay", owner: "launcher-runtime", summary: "record/playback preserves the multiplayer authoritative input model and is exposed through the shared Replay experience" },
  { id: "peer-transport-and-relay-fallback", owner: "launcher-runtime", summary: "WebRTC peer transport is supported and the configured shared WebSocket relay can be used as fallback without title-specific service configuration" },
  { id: "local-player-visibility", owner: "runtime", summary: "the shared local-player visibility option marks the local player without changing gameplay state" },
  { id: "network-rollback-diagnostics", owner: "launcher-runtime", summary: "connection/rollback state is surfaced through the shared diagnostics model" },
  { id: "runtime-exit-room-lifecycle", owner: "launcher", summary: "ending/leaving a multiplayer Runtime returns to the room/session lifecycle rather than destroying unrelated Launcher state" },
] satisfies readonly OptionalProfileBehavior[]);

export const REQUIRED_THPRAC_BEHAVIORS = Object.freeze([
  { id: "runtime-attestation", owner: "host", summary: "Host publication may advertise thprac only when the product declares it and the concrete Runtime Release attests it" },
  { id: "prelaunch-enable-and-locale", owner: "launcher-runtime", summary: "the Runtime receives the canonical thprac enable flag and locale before authoritative game launch; live practice parameters are not Launcher-owned configure state" },
  { id: "runtime-owned-live-session", owner: "runtime", summary: "the practice Runtime owns the materialized live practice state and keeps its portable/replay mirror synchronized across Practice, Restart, Replay and ordinary Start boundaries" },
  { id: "shared-practice-parameters", owner: "runtime", summary: "the supported practice surface applies the shared stage/frame/resource/score/rank parameters without claiming unported upstream features" },
  { id: "replay-prac-metadata", owner: "runtime", summary: "practice parameters needed for playback are embedded/validated in the supported Replay model rather than depending on an unpublished external sidecar" },
  { id: "touch-function-bridge", owner: "launcher-runtime", summary: "shared touch controls can drive the function-key interactions required by the supported practice UI; menu pointing is native Runtime input" },
  { id: "locale-propagation", owner: "launcher-runtime", summary: "the selected Launcher language is translated into the thprac locale contract before launch" },
  { id: "no-false-upstream-claims", owner: "launcher", summary: "upstream thprac features that are not ported are not exposed merely because the thprac profile is enabled" },
] satisfies readonly OptionalProfileBehavior[]);

export const REQUIRED_LANGUAGE_BEHAVIORS = Object.freeze([
  { id: "built-in-japanese-baseline", owner: "launcher-runtime", summary: "Japanese/original resources remain the built-in fallback and require no downloadable language pack" },
  { id: "validated-pack-publication", owner: "host", summary: "published language packs carry validated bytes/hash/runtime compatibility metadata and appear in the selectable catalog only when actually packaged" },
  { id: "prelaunch-resource-application", owner: "launcher-runtime", summary: "validated language resources/fonts are installed before game launch and mounted at the Runtime targets declared by the language profile" },
  { id: "safe-launch-fallback", owner: "launcher-runtime", summary: "a missing or failed optional language pack falls back for that launch instead of corrupting the durable language preference or preventing Japanese launch" },
  { id: "font-coverage-resource", owner: "host", summary: "language publication supplies a legal font resource covering the required glyphs rather than assuming a thcrap font name is a browser font file" },
  { id: "original-resource-fallback", owner: "runtime", summary: "when a translated resource is absent the Runtime falls back to the title's original resource instead of treating translation completeness as mandatory" },
] satisfies readonly OptionalProfileBehavior[]);

export const REQUIRED_MIDI_BEHAVIORS = Object.freeze([
  { id: "selector-only-when-declared", owner: "launcher", summary: "MIDI appears in music selection only when the product declares the capability and the publication exposes a valid MIDI path" },
  { id: "audible-midi-transport", owner: "launcher-runtime", summary: "selecting MIDI produces actual title music through the shared MIDI transport rather than a silent compatibility value" },
  { id: "music-lifecycle", owner: "runtime", summary: "MIDI follows ordinary title music start/stop/fade/pause lifecycle and does not continue across Runtime teardown" },
  { id: "separate-from-ogg", owner: "launcher-runtime", summary: "MIDI selection does not require or masquerade as the required OGG music path; OGG remains the normal-music contract" },
] satisfies readonly OptionalProfileBehavior[]);

export interface GameOptionClassification {
  readonly capability: string;
  readonly class: "required" | "inherited" | "profile-required" | "optional";
  readonly owner: "launcher-runtime" | "launcher" | "product";
  readonly note?: string;
}

// Every persisted/shared gameplay option must say what kind of feature it is.
// This closes a common ambiguity where a Launcher switch existed before anyone
// decided whether the next Runtime had to implement it.
export const GAME_OPTION_CLASSIFICATION = Object.freeze({
  thpracEnabled: { capability: "thprac", class: "optional", owner: "product" },
  thpracTouchControlsEnabled: { capability: "thprac-touch-bridge", class: "profile-required", owner: "launcher-runtime" },
  magnifierEnabled: { capability: "magnifier", class: "inherited", owner: "launcher" },
  focusHitboxEnabled: { capability: "focus-hitbox", class: "optional", owner: "product" },
  faithBarEnabled: { capability: "faith-bar", class: "optional", owner: "product" },
  frameLimit60Enabled: { capability: "frame-limit-control", class: "inherited", owner: "launcher" },
  touchEnabled: { capability: "touch-controls", class: "required", owner: "launcher-runtime" },
  touchMovementMode: { capability: "touch-controls", class: "required", owner: "launcher-runtime", note: "all four movement modes belong to REQUIRED_TOUCH_BEHAVIORS" },
  touchSensitivity: { capability: "touch-controls", class: "required", owner: "launcher-runtime", note: "100–300 percent protocol range" },
  touchControlOpacity: { capability: "touch-controls", class: "inherited", owner: "launcher", note: "shared presentation opacity, never forwarded as gameplay input" },
  touchFocusMode: { capability: "touch-controls", class: "required", owner: "launcher-runtime", note: "hold/toggle/two-finger modes" },
  doubleTapBombEnabled: { capability: "touch-controls", class: "required", owner: "launcher-runtime" },
  restartButtonEnabled: { capability: "restart-action", class: "required", owner: "launcher-runtime", note: "the preference only controls shared Launcher R-button visibility; every adapter still owes pause-menu restart semantics" },
  alwaysHitbox: { capability: "always-hitbox", class: "required", owner: "launcher-runtime" },
  multiplayerLocalPlayerVisibility: { capability: "multiplayer-local-player-visibility", class: "profile-required", owner: "launcher-runtime" },
  externalMidiDeviceId: { capability: "midi-music", class: "optional", owner: "product", note: "opaque MIDIPort.id of the selected output; empty means the first available device. The external-MIDI on/off switch is session-only Launcher state and deliberately not a GameOptions field" },
} satisfies Readonly<Record<string, GameOptionClassification>>);

// These features are already owned by the Launcher. A new game receives them
// by participating in the shared player/runtime boundary; its Runtime must not
// fork or reimplement the UI feature. Some inherited features depend on a
// required transport capability (for example the touch layout editor depends
// on required touch-controls), but that does not make the editor game-specific.
export const INHERITED_LAUNCHER_CAPABILITIES = Object.freeze([
  { id: "touch-layout-editor", class: "inherited", owner: "launcher", summary: "shared touch button layout, scale, sensitivity UI and orientation profiles" },
  { id: "magnifier", class: "inherited", owner: "launcher", summary: "host-side game viewport magnification and pinch UI" },
  { id: "fullscreen-orientation", class: "inherited", owner: "launcher", summary: "fullscreen, orientation, viewport placement and host layout controls" },
  { id: "replay-manager-ui", class: "inherited", owner: "launcher", summary: "shared Replay list/import/export/rename/delete UI over the required file protocol" },
  { id: "package-manager-ui", class: "inherited", owner: "launcher", summary: "Package Store install/update/import and transfer UI" },
  { id: "launcher-localization", class: "inherited", owner: "launcher", summary: "Launcher interface localization; distinct from optional in-game language packages" },
  { id: "pwa-app-shell", class: "inherited", owner: "launcher", summary: "Service Worker/App Shell lifecycle for Launcher-owned files" },
  { id: "site-information", class: "inherited", owner: "launcher", summary: "FAQ, first-use notice, site notice and support surfaces" },
  { id: "frame-limit-control", class: "inherited", owner: "launcher", summary: "shared 60 Hz presentation-limit UI; the Runtime obligation is the required presentation-cadence contract" },
] satisfies readonly AdapterCapabilityDefinition[]);

// A profile-required capability becomes mandatory when its parent optional
// product capability is enabled. This is how we express “not every game needs
// multiplayer, but every multiplayer adapter must implement this behavior”.
export const PROFILE_REQUIRED_CAPABILITIES = Object.freeze([
  { id: "multiplayer-local-player-visibility", class: "profile-required", owner: "launcher-runtime", when: "multiplayer",
    summary: "multiplayer Runtime visually identifies the local player when the shared Launcher option is enabled" },
  { id: "multiplayer-spectator-input-isolation", class: "profile-required", owner: "launcher-runtime", when: "multiplayer",
    summary: "spectator sessions must not inject gameplay/touch input into an authoritative player" },
  { id: "thprac-touch-bridge", class: "profile-required", owner: "launcher-runtime", when: "thprac",
    summary: "a thprac-capable Runtime supports native touch pointing plus the declared function-key bridge used by shared touch UI" },
  { id: "language-runtime-application", class: "profile-required", owner: "launcher-runtime", when: "languages",
    summary: "a language-capable Runtime applies a validated language pack and falls back safely when optional content is unavailable" },
  { id: "midi-runtime-path", class: "profile-required", owner: "launcher-runtime", when: "midi-music",
    verification: ["workspace:tests/test-midi-capability-contract.mjs", "browser:tests/browser/test-music-selection.py"],
    summary: "a MIDI-capable product actually produces music through the shared MIDI transport rather than exposing a silent option" },
] satisfies readonly AdapterCapabilityDefinition[]);

// These are genuine product differences. Shared UI/orchestration may consume
// their declarations; a new adapter is not incomplete merely because one is
// false or absent.
export const OPTIONAL_PRODUCT_CAPABILITIES = Object.freeze([
  { id: "midi-music", class: "optional", owner: "product", declaration: "musicCapabilities.midi",
    verification: ["workspace:tests/test-midi-capability-contract.mjs", "browser:tests/browser/test-music-selection.py"],
    summary: "MIDI playback in addition to normal OGG music" },
  { id: "thprac", class: "optional", owner: "product", declaration: "features.thprac",
    verification: ["repository:tests/test-integrations.mjs", "workspace:tests/test-shell-protocol.mjs"],
    summary: "thprac integration" },
  { id: "languages", class: "optional", owner: "product", declaration: "features.languages",
    verification: ["repository:tests/test-format-adapter-coverage.mjs", "repository:tests/test-language-publication-contract.mjs"],
    summary: "downloadable language packages through the product-declared preparation adapter" },
  { id: "multiplayer", class: "optional", owner: "product", declaration: "multiplayer",
    verification: ["repository:tests/test-netplay-relay-product-policy.mjs", "repository:tests/test-multiplayer-runtime-options.mjs", "browser:tests/test-multiplayer-replay-launcher-browser.py", "browser:tests/test-th07mp-ui.py"],
    summary: "multiplayer Runtime and room/loadout bounds; product-catalog validation requires multiplayerRuntime and multiplayer metadata to move together" },
  { id: "focus-hitbox", class: "optional", owner: "product", declaration: "features.focusHitbox",
    verification: ["repository:tests/test-product-catalog.mjs", "repository:tests/test-host-manifest.mjs", "workspace:tests/test-shell-protocol.mjs"],
    summary: "product-specific focused-state hitbox enhancement; distinct from required always-hitbox" },
  { id: "faith-bar", class: "optional", owner: "product", declaration: "display.faithBar",
    verification: ["repository:tests/test-product-catalog.mjs", "repository:tests/test-game-preferences.mjs", "browser:tests/test-th10-original-options-browser.mjs"],
    summary: "original player overhead faith gauge controlled through the title's custom configuration" },
  { id: "hint-files", class: "optional", owner: "product", declaration: "storage.hintFiles",
    verification: ["repository:tests/test-product-catalog.mjs", "browser:tests/test-th10-original-options-browser.mjs"],
    summary: "original stage Hint text files in mutable save storage" },
  { id: "raw-data-import", class: "optional", owner: "product", declaration: "package.rawDataImport",
    verification: ["repository:tests/test-raw-data-import-policy.mjs", "repository:tests/test-product-catalog.mjs"],
    summary: "direct acquisition from a named retail DATA file; accepted bytes must enter the canonical Package Store at the product-declared data target" },
  { id: "adaptation-notice", class: "optional", owner: "product", declaration: "support.adaptationNotice",
    verification: ["repository:tests/test-product-catalog.mjs", "repository:tests/test-product-surface.mjs"],
    summary: "temporary support/early-test notice" },
] satisfies readonly AdapterCapabilityDefinition[]);

// Internal mechanisms used by existing Runtime adapters. They may be important
// to those implementations, but a new title owes the higher-level behavioral
// contract rather than the same mechanism. This category exists specifically
// to prevent "the previous game has code for X, therefore the next game must
// copy X" from becoming architecture by accident.
export const IMPLEMENTATION_DETAILS = Object.freeze([
  { id: "eagx-replay-sidecar", class: "implementation-detail", owner: "runtime",
    summary: "TH06/TH07 ReplayExtension/EAGX sidecar used by their existing analog/touch and multiplayer Replay architecture; not a separate touch-Replay product capability and not a template requirement" },
  { id: "continuous-motion-replay-sidecar", class: "implementation-detail", owner: "runtime",
    summary: "TH08/TH10 sparse motion trailer exposed as .rpyx when continuous movement cannot be represented by the retail Replay input stream; an adapter may use another deterministic solution" },
  { id: "presentation-sidecars", class: "implementation-detail", owner: "runtime",
    summary: "per-owner previous/current presentation snapshots used by current high-refresh Runtimes; another renderer may satisfy presentation safety differently" },
  { id: "runtime-prewarm-cache", class: "implementation-detail", owner: "runtime",
    summary: "directory-Runtime asset/font/ANM prewarm caches used for startup performance; not part of the browser protocol or product capability surface" },
  { id: "thprac-live-session-mirror", class: "implementation-detail", owner: "runtime",
    summary: "TH06/TH07 use eagler-touhou/thprac-session/1 as a Runtime-owned live/Replay bridge between PracticeRuntime and the portable thprac adapter; this is not a Launcher-owned session configuration requirement for a new title" },
  { id: "wav-host-music-path", class: "implementation-detail", owner: "maintainer",
    summary: "WAV/preload music preparation remains a maintainer/content-build path for existing preload Runtimes; the formal player music surface is required OGG + no-music with optional MIDI, so a new title need not implement WAV" },
] satisfies readonly AdapterCapabilityDefinition[]);

// These are implementation adapters for original formats. They may be needed
// to deliver a required/optional capability, but they are never Launcher
// feature flags and should not be copied to a new game unless its format needs
// them.
export const FORMAT_ADAPTERS = Object.freeze([
  { id: "retail-data-decoder", class: "format-adapter", owner: "format", summary: "decode/assemble the title's original DATA/archive format" },
  { id: "replay-codec", class: "format-adapter", owner: "format", summary: "parse/convert that title's original Replay format" },
  { id: "score-config-codec", class: "format-adapter", owner: "format", summary: "parse or preserve original score/config formats" },
  { id: "artwork-music-extractor", class: "format-adapter", owner: "format",
    verification: ["repository:tests/test-product-catalog.mjs", "repository:tests/test-host-artwork-adapter-coverage.mjs", "repository:tests/test-format-adapter-coverage.mjs", "python:tests/test_touhou_formats.py"],
    summary: "extract title artwork/music from legally owned retail content; artwork coverage must include every formal Product Catalog game while each retail decoder remains title/format-specific" },
  { id: "thcrap-runtime-language-compiler", class: "format-adapter", owner: "format",
    verification: ["repository:tests/test-format-adapter-coverage.mjs", "repository:tests/test-thcrap-compiler.mjs"],
    summary: "binary/patch compilation path for products that explicitly declare the thcrap-runtime-compiler preparation adapter; it is selected by content metadata and is not a requirement for later titles using another language mechanism" },
] satisfies readonly AdapterCapabilityDefinition[]);

// Compatibility exists only because an older Eagler Touhou version already
// shipped a state/format. It is not precedent for new adapters.
export const COMPATIBILITY_ADAPTERS = Object.freeze([
  { id: "legacy-package-reader", class: "compatibility", owner: "legacy", summary: "read retired game-data-pack/offline-game-pack inputs and migrate into Package Store" },
  { id: "legacy-browser-storage-migration", class: "compatibility", owner: "legacy", summary: "one-way migration of historical localStorage/Cache/custom IndexedDB owners" },
  { id: "legacy-runtime-alias", class: "compatibility", owner: "legacy", summary: "bounded compatibility for previously published module/path names" },
  { id: "legacy-touch-bomb-zone-option", class: "compatibility", owner: "legacy", summary: "TH06/TH07 may still accept the retired touchBombZoneEnabled field; the current Launcher fixes it false and new adapters must not copy the old screen-region Bomb gesture" },
  { id: "legacy-local-player-visibility-option", class: "compatibility", owner: "legacy", summary: "TH06/TH07 may read the retired enhanceLocalPlayerVisibility option as a fallback; the canonical shared preference is multiplayerLocalPlayerVisibility" },
  { id: "legacy-unlimited-touch-option", class: "compatibility", owner: "legacy", summary: "older TH06/TH07 hosts may supply unlimitedTouch; the canonical shared option is touchMovementMode=touch-unlimited and new Launchers no longer send the alias" },
  { id: "legacy-th06-focus-hitbox-option", class: "compatibility", owner: "legacy", summary: "older preferences/hosts may use th06FocusHitbox; current state and Runtime payloads use the generic focusHitboxEnabled name" },
  { id: "legacy-th07-netplay-environment", class: "compatibility", owner: "legacy", summary: "TH07_* relay/TURN environment names remain read-only aliases for existing deployments; shared service configuration uses EAGLER_NETPLAY_* and new titles must not introduce title-prefixed service variables" },
  { id: "legacy-release-directory-parameters", class: "compatibility", owner: "legacy", summary: "formal release may still read Th06Directory/Th07Directory/... and title-specific LanguagePacks parameters, but canonical release input uses GameDirectories and LanguagePackDirectories maps; new titles must not add new per-title release parameters" },
  { id: "legacy-maintainer-runtime-build-parameters", class: "compatibility", owner: "legacy", summary: "low-level maintainer tools still accept historical title-specific Runtime build/asset parameters such as Th08Build/Th10Build and Th06AssetDirectory/Th07AssetDirectory; canonical tooling uses Runtime Release, runtime-builds.json and generic maps, and new titles must not add another ThNNBuild/ThNNAssetDirectory parameter" },
  { id: "legacy-wav-music-preference", class: "compatibility", owner: "legacy", summary: "old saved Launcher music='wav' values migrate to the current OGG stream preference; WAV is not a current player-selectable music capability" },
  { id: "legacy-wav-runtime-music-mode", class: "compatibility", owner: "legacy", summary: "older preload shells may still accept configure.music='wav' for historical hosts/tests; the canonical Runtime configure music values are OGG, MIDI and none, so a new adapter must not implement WAV as a player mode" },
  { id: "legacy-thprac-session-host-injection", class: "compatibility", owner: "legacy", summary: "TH06/TH07 shells may still accept options.thpracSession and emit the optional thprac-session event for older hosts/tests; the current Launcher does not send that field and new adapters must not treat it as canonical configure state" },
] satisfies readonly AdapterCapabilityDefinition[]);

export const ADAPTER_CAPABILITIES = Object.freeze([
  ...REQUIRED_ADAPTER_CAPABILITIES,
  ...INHERITED_LAUNCHER_CAPABILITIES,
  ...PROFILE_REQUIRED_CAPABILITIES,
  ...OPTIONAL_PRODUCT_CAPABILITIES,
  ...IMPLEMENTATION_DETAILS,
  ...FORMAT_ADAPTERS,
  ...COMPATIBILITY_ADAPTERS,
]);

export function adapterCapability(id: string): AdapterCapabilityDefinition | null {
  return ADAPTER_CAPABILITIES.find(item => item.id === id) ?? null;
}
