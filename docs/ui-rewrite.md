# React launcher maintainer lane

React is the only current frontend for development, self-hosting and hosted/external/import publication. The UI uses shared components, and contracts/services retain Runtime, Package Store and multiplayer ownership. The former Launcher renderer and its page/history entrypoints are retired.

## Development and verification

Use Node.js 24 with dependencies installed using `npm ci --ignore-scripts`. Run:

```sh
npm run typecheck:ui-rewrite
npm run typecheck:ui-rewrite:tools
npm run test:ui-rewrite
npm run build:ui-rewrite
npm start
```

For a launcher checkout below `worktrees`, set `EAGLER_WORKSPACE_ROOT` to the actual workspace root. Development serving uses a root-mounted artifact.

`EAGLER_REACT_BUILD_DIRECTORY` selects the build output directory, defaulting to `.cache/build/ui-rewrite`. `EAGLER_REACT_MOUNT_PATH` selects the build-time mount, defaulting to `/`. Build and host selection must use the same mount. A nested artifact belongs on a matching mounted static host. An existing built artifact is consumed without invoking the compiler during host assembly.

Offline support is an explicit deployment choice. Set both `EAGLER_REACT_APP_SHELL=isolated` and `EAGLER_REACT_APP_SHELL_ORIGIN` to the exact intended origin before building. Setting only a mount does not enable offline caching or worker registration. The built metadata binds the worker to that origin and mount, and rejects foreign or ancestor registrations. Rebuild to change this identity. `refresh:deployment-frontend` consumes a matching verified artifact. Older full-UI deployments must be repackaged; the refresh tool never republishes a second UI.

## Components and return policy

The launcher home now uses `GameDirectory` and a persistent `GameWorkspace`.
Each game occupies one square-artwork slot derived from the current catalog;
one click selects its business context and retains a usable directory beside
it. Desktop pointer magnification and edge scrolling have one disposable DOM
owner; portrait devices use native horizontal scrolling. Reduced-motion and
coarse-pointer environments do not run the pointer magnification loop.
Desktop directories replace the heading with an edge-connected category dock.
`DesktopDirectoryMenu` owns its proximity/focus/retraction and 1600ms arrival
notice. Its viewport-fixed top follows the header's height, so workspace
departure/arrival layouts cannot shift it. The60px dock ends12px before the
workspace and has no separate menu button. Borderless options share one red
selection capsule that slides/resizes in320ms, respecting reduced motion.
Wheel input browses the masked option row horizontally without a scrollbar.
Mouse proximity to either horizontal edge also scrolls this row proportionally
to proximity, stopping on leave/cancel/blur, at either limit, or when interaction
or full motion is disabled. Mouse and pointer input are supported; touch
compatibility events cannot start it. It never activates a category or game.
Work scrolling retracts it to a30px semicircle, including after a filter held focus;
keyboard focus on the dock opens it, Enter reaches the selected option, and
Escape retracts it without activating a game.
The top of the rail always expands the menu. After user scrolling, it also
expands whenever its viewport region has no overlapping visible card; a cover
passing that region retracts it again. Arrival cues and pointer/focus access
retain priority. Scroller resize/window resize reevaluate the free region.
The default All view groups mainline, classic, decimal and fan works in that order,
with spacing/dividers (including site→mainline) and vertical empty-category placeholders. An explicit
category shows only its works, retaining the site entry and current workspace.
`directoryCategory` metadata overrides the official-number fallback (1–5 are
classic works, later integer releases are mainline); this is
presentation metadata, not a second publication or room-product registry.
The first entry crossing the rail's visible bottom prompts its category without
changing the filter. Programmatic initial selection alignment never prompts.
Narrow directories replace the heading with a persistent centered category row,
using the same selection capsule as desktop. The frame stays centered and is
capped at340px/available space. All five choices have equal widths and heights;
English labels may scroll within the option row.
Overflow stays inside the option row. Filter scope is shared across
responsive layouts, but the narrow visual highlight follows the centered
entry when scope is All. `aria-pressed` describes filtering and `aria-current`
describes that visual location; automatic highlighting never changes the filter.
Portrait groups flatten into the native horizontal carousel with vertical
dividers. Empty groups have centerable Coming soon entries, which update the
category highlight without calling product/site navigation. Explicit filters
remove other groups. A deliberate narrow category request aligns the current
game in that category, or its first visible game, and commits it after settlement.
Resize retains the pending commit; a manual scroll interrupts it. Initial
alignment and empty placeholders never invent a game selection. On desktop,
a category chosen from the site opens its first available game; filtering an
already selected game preserves the current workspace. Resize retains a browsed
empty entry or an in-flight alignment target.
Room locks keep the freely scrolling, unsnapped rail and block work activation
while allowing category browsing.
Selecting All issues a separate home request even when its filter is already
All. Portrait restores all groups, smoothly centers the site entry and invokes
the existing site callback only after settling. Resize retains that target;
user wheel/drag interrupts it, and a late scrollend cannot duplicate the callback.
Locked/disabled-site rails may return to the start without activating the site
or a game. Desktop All returns the vertical rail to its top without changing
the selected workspace. Carousel/media synchronization remains the one owner.
Desktop Game Info's rail extends across the header/footer grid gaps, clipping
at the header bottom and credits divider while preserving workspace spacing.
`SiteWorkspace` receives the startup owner's parsed notices and supports explicit
safe refresh. This preserves the single startup notice request.

The multiplayer directory retains `LibraryCards`, its existing card renderer,
options presence and native dialog. `useLibraryOptionsPresence` now controls
that modal carrier rather than the launcher's persistent information panel.
Room drawers retain the existing `OptionsPanel` relocation and state ownership.

Header settings now open `SettingsWorkspace` as the main card for library,
lobby and room. The game-card action opens the same card with a Game scope.
The Router's bounded informational entry carries that scope without rewriting
the game/room URL. Both responsive layouts send the outgoing workspace below
and bring settings down from above; closing reverses this exchange. Original
game/lobby/room directions remain. A stable hidden/inert `workspace-current`
retains the previous scene and iframe, so opening settings does not leave a room
or discard seat-selection state. Directory selection can return to a game/site.
`SettingsBody` renders every settings group as a section for this card, without
disclosures. Clicking the Header action a second time closes global settings
and returns to the preceding workspace through the same Router entry. Desktop
places touch/display side by side and advanced options across two columns below,
with denser spacing in short windows and no internal scroller; portrait
grows naturally and scrolls with the page. The file dialog retains its native
informational shell and single file owner. Touch editing is a same-URL child
of the global settings card and returns to it; layout is shared, so local cards
explicitly route users to global settings before editing it.

`createGameSettingsModel.createEditor` creates a scoped editor over the same
preference authority. Global defaults use a sparse `eagler-touhou-global-settings-v1`
record; explicit game overrides use `eagler-touhou-local-settings-v1-{preferenceId}`.
Legacy complete per-game records remain the baseline, followed by global fields
and explicit local fields. Global edits never bulk rewrite those records; local
touch edits do not update the legacy shared-touch record. Unsupported features,
languages/music and room movement constraints adapt in the effective model.
Global editors expose desired defaults across the catalog, including music
unavailable on the current device; game settings apply their actual capabilities.
MIDI output preferences persist with the chosen scope; the session port receives
the effective output after respecting game overrides. MIDI enablement still has
its existing per-visit permission/switch boundary. Failed persistence retains
scoped changes in memory for this document. Context/locale metadata refreshes
reuse the editor and fields, rather than replace a pending control owner.

`ScorePanel` presents a compact summary,
a five-difficulty clear matrix (loadout columns / difficulty rows), gameplay
duration and favorite artwork for TH06–TH10 from the chosen archive or existing
durable IDBFS save. `SaveChoice` reuses `MainSelect` beside Files/Replays. Portrait
presentation puts its label, value and arrow inside the same40px capsule via
`MainSelectPrefix`, retaining one native value owner and one clickable trigger.
Recovery/error messages remain outside that control. Its service never
boots a runtime or writes a save; refresh pauses during native loading, play
and file operations, then resumes after completion. Dedicated story clear flags
distinguish no-continue clears (green) from continued clears (muted yellow);
any recorded no-continue clear takes precedence. TH08 accepts either ending's
completion bit, without treating stage-access bits as completion. TH10 uses an
explicit completed ranking's continue count; TH09 aggregate clears cannot be
paired with an unrelated ranking's continue byte. Aggregate-only history that
does not distinguish continues retains the previous green/plain Cleared display,
with no extra outline or message. Practice/unlock flags, default rankings and
aggregate loadouts do not mark cells. See [DAT clear evidence](score-clear-records.md)
for field semantics and primary sources. Gameplay duration uses the saved play-time
field for TH07/TH08 and authoritative total frames (or distinct loadout frames)
for TH10. Missing or unconfirmed duration fields render no duration text;
recorded zero remains visible. The matrix aligns left and vertically centers
in the upper portion of the desktop artwork stage; portrait uses a compact210px
stage with one centered matrix region, removing the unused lower grid track and
moving duration upward. Its top-left corner has no visible
Difficulty text, retaining the accessible axis label. The matrix can use the full stage width, shrinking cells and gaps
to display every column without horizontal scrolling. Only squares approaching
the artwork fade; fine-pointer proximity, keyboard focus or a completed touch/pen tap
reveals them. Cancelled scrolling gestures do not reveal them. Touch reveal stays until an outside pointer/focus interaction.
Cells highlight both axes; difficulty/loadout header hover or keyboard focus
highlights just its own row/column. Touch movement does not synthesize hover.
Short desktop grids also fit their cells to the available stage height.
Duration sits below the artwork stage at the lower left, aligned above Launch,
with a Play time prefix and hour/minute numbers at2.3-times unit size, using
the shared UI font. A shared `score-content` contains the matrix stage, duration
and portrait. The adaptation notice also occupies this area on the left, so it
cannot push the artwork away from the launch-button boundary. Launcher artwork anchors to that area's lower-right edge, with
bottom-aligned images and credit text above the launch footer on both responsive
layouts; it no longer centers within the matrix stage. Matrix container sizing
is retained and duration text stays above the artwork. Room portraits keep their
existing independent layout. Footer actions match toolbar capsule height, type and
padding. Desktop Launch/Multiplayer split remaining width equally after the
intrinsic Import button. Portrait Launch occupies the full first row;
Multiplayer fills the second row's remaining width beside the unchanged Import.
Portrait summaries retain three columns with
responsive type and wrapping within each column, now with aligned value baselines
and reduced toolbar/summary spacing. `favoriteLoadout` remains recorded play
frequency only, including paired TH08 characters. The separate display-only
`featuredLoadout` falls back to known per-loadout clear counters (excluding totals,
unknown difficulties and duplicate fields), then unique difficulty coverage.
Clear-count ties use coverage; remaining ties, no evidence, or a matrix where
every loadout has cleared all five difficulties yield no fallback loadout.
The summary and artwork label the chosen basis as most-played, most-cleared or
widest coverage; clears never become plays. Without a selected loadout, artwork
is not rendered, including absent/unreadable/unsupported saves and tied clears.
The empty artwork region does not retain a square-fading mask. Default-game
artwork is no longer a Game Info fallback; room character artwork is unchanged.
Unsupported or unreadable saves
retain the existing launch and file-management paths. Selectable save slots now apply before native launch through the existing
exclusive file session, following a committed backup and durable verification.
`FilesWorkspace` now presents saves/replays as a main workspace card. Its Router
information entry is retained for Back/Forward, but no native modal wraps it.
On desktop, independent save and replay lists sit in two columns; narrow layouts
stack them. Each heading keeps its import action on the right, and every file
has an export action. The replay list owns its bounded vertical scroll; it never
scrolls the save column. The top-left Back button aligns with the Files opener.
Opening moves the existing game card upward and brings files in from below;
return reverses that exchange and restores opener focus. Incoming motion waits
until the next frame after Router scroll restoration; the pending card is
concealed/inert and measured at its restored position. Card exchange also
excludes browser scroll anchoring. Nested global settings
retain the files card and its replay owner beneath the settings card.
`SaveLibraryPanel` uses compact name/size/action rows, without routine summaries,
status badges or helper captions. Its permanent `本机存档` row cannot be renamed
or removed. It has an export action and the same round trash action as archived
copies; after a danger confirmation, that action clears only the game's native
score file while keeping the row, configuration, replays and archive copies.
TH10 clears both native language editions and verifies each after reopening.
This operation uses the original exclusive Runtime file owner; it is not an
atomic transaction across both editions. Unsupported archive titles retain the
original native import/export/clear service path.
Imported copies keep validated per-title imports, duplicate detection and
exact-byte downloads. All save names are now read-only text, including archive
names; neither names nor non-action row areas open an editor. Confirmed removal
atomically deletes only that archive and resets its
selected binding to native when needed; pending writeback blocks removal, and
automatic backups remain intact. Recovery and backup actions appear only during
an actual pending recovery. Current-save comparison uses the read-only service
and pauses during Runtime work. The underlying archive database does not write
native IDBFS files.
TH10 hint-file actions remain in the save column. The replay panel opens the
existing `ReplayModel`, lists actual native files, and reuses its download and
mutation queue. Import refreshes those rows; leaving closes the model and
releases only an idle Runtime acquired for its file session. No match is started.

Game-scoped settings now mark option/music values that differ from their global
baseline and provide a per-field return to global settings. This removes only
that field's local override and updates its legacy preference fallback; other
game settings are retained. The desktop category menu expands for pointer and
keyboard browsing, then recentres the chosen option within the game rail.
Announcement brand icons disappear when their optional asset fails to load.
TH10 play-time parsing falls back to distinct loadout totals when an older save
contains a zero aggregate beside nonzero loadout records.
The integration also retains main's independent original/beautified package
install slots and manual startup after resource import. Game version selection
stays in the per-game settings card; it is not exposed as a global preference.

`page-history.ts` declares fixed page parents: launcher is the root, lobby returns to launcher, single-player options return to launcher, and multiplayer options and rooms return to lobby. Direct invitations seed those same browser history parents. Page buttons and browser Back use the same navigation owner and save/leave cleanup. History records retain bounded ancestor positions, not a separate route stack or inferred entry source.

`InformationalDialog` owns the native modal shell and `useMainDialog` lifecycle for Apple refresh help, donations and multiplayer rules. Callers supply body content and one explicit layout: standard, artwork-width or scrollable. All three use the same completion-driven Web Animations adapter, including interruption and reduced-motion handling. Native animation completion closes the dialog; there is no mirrored CSS duration, fallback close timer or separate presence owner. Unsupported/partial animation APIs degrade to immediate presentation and closure. Donation's immediate-close mode and unavailable-artwork action use that same lifecycle. The shared motion replaces the older per-dialog timings with one whole-dialog fade/translate; backdrop colors remain static until native close. This intentional visual change still needs browser review. Other numeric `useMainDialog` callers retain their established timing. The colocated stylesheet is React's sole shell styling owner; old Apple/guide selectors in `public/styles.css` remain unchanged for canonical main, and no React shell matches them.

Attached dialogs and the touch editor return to their opener. Gameplay has one Back layer over its options or room. Save failure retains the existing Retry/Leave/Stay decision. The persistent iframe follows main's validated `src` assignment/removal, rather than replacing its Window history. After save consent, Player close exits fullscreen and waits for the blank iframe document to commit before completing navigation. The host reattaches that same iframe node to discard the retired child browsing context and its history before another launch. A completed game replaces its active entry with its options or the same room, so it does not traverse an earlier game iframe snapshot. Room departure replaces the address with the selected game's lobby, including after refresh and direct invitations. An explicit native Return to Menu leaves membership after closing the Player. TH09's native title room remains an attached overlay of its retained runtime.

Synthetic mounted tests cover routing, native message boundaries and ownership. They do not establish actual game, mobile-device or durable browser-storage acceptance. Real browser and native runtime gates remain required before replacing the production frontend.

## Historical pre-merge record — before the React-only migration

This historical record is not acceptance of the subsequent migration. Synchronization is committed, but this record does not authorize
merging into main, switching the default frontend, or publishing/deploying.

The source candidate is `ace43d76c3a019308ba102eb25927f59def231ca`.
Local main is `28bda8ca502b3d643eed3a5b705eb38d15769ad0`; fetched origin/main is
`edee9633e5e3ee79cd2e1aa334f84f6caf755090`. Both are ancestors of the candidate.
The local main commits added TH11 multiplayer and native Return-to-Menu room
departure. Merge `b5a42505f83b5cce10893402f5428c8d998bad34` retains both histories,
including origin/main's editable nicknames. The sole content conflict was the
rule renderer: its shared extraction was retained and the TH11 tab added there.
Main's catalog, room relay, spectator protocol, runtime/build configuration and
authored rule document are unchanged by the rewrite synchronization.

Preparatory changes and their purposes:

- `28025f7`: checkpoint the previously browser-verified runtime retirement,
  fullscreen/save order, fixed room/lobby returns and native browser API bindings.
- `b5a4250`: port main's no-rollback declaration into React's room control,
  mutation guard, start packet, snapshot validation and runtime options. Zero
  prediction remains zero. Port native stopped-game diagnostics and an actionable
  return for players and spectators. Rebase parity fixtures on committed main
  inputs while preserving the separately accepted editable-name behavior.
- `cd6d2e4`: give the new TH11 browser test an explicit package command so it is
  owned by a discoverable acceptance lane.
- `4d6febd`: fetch both committed parity authorities in shallow CI checkouts.
- `225ca47`: wait for all lobby close handshakes before asserting reuse of room
  quota. Hiding a directory row does not establish that the room was deleted.
- `ace43d7`: extend notice/controller and keyboard-tab parity to main's TH11 rules.

| Gate | Evidence and result |
| --- | --- |
| UI and tools type checks | PASS, Node 24.13 on Windows. |
| Main module compilation and generated content | PASS, 69 authored TypeScript modules and content freshness check. |
| React production build | PASS. Default frontend remains main; React and isolated App Shell remain explicit selections. |
| Full React synthetic suite | 1203 cases executed: 1200 passed, 3 stale four-tab oracle assertions failed. Those fixtures were updated and the complete affected notice/guide set passed (97 cases). A fresh green whole-suite CI result is still required. |
| Notice/guide final regression | PASS, 97 tests after updating the committed main oracle and five-tab traversal. |
| Site notice | PASS, 36 cases against its unchanged origin/main authority. |
| Repository core | 120 scripts executed. Initial run: 118 passed, room-quota race and Windows symlink failure. The quota fixture was corrected and passed; the other 118 scripts were unchanged. Atomic deployment remains blocked by EPERM, not skipped. |
| Publication audit | PASS for tracked source candidates. This does not verify a public deployment. |
| Linux CI | NOT RUN for this unpushed candidate. Must pass the normal core and rewrite jobs before promotion. |

Local logs and exact changed-file inventory are retained under `.cache/premerge-*`.
They are diagnostic evidence, not distributable release artifacts. The unrelated
pre-existing `design-qa.md` edit is preserved and excluded from these commits.

Browser evidence uses Windows Chrome 155 on two localhost origins, separate
members, a private room, the actual game Runtime and the shared public signaling
relay. TH11 entered Stage 1 with streaming OGG, advancing confirmed input and
RTC direct channels. The real Module received mode 1, prediction 0, and P2
`{character:1, shot:1}` for Marisa B. The native pause menu contained four entries.
The same page launched successive Runtime epochs 1 and 4. Menu Restart reached
fresh calibration and reset the confirmed-frame counter; complete gameplay-state
reset is not established by that observation. Manual error recovery returned to
the same room, and room departure returned to `lobby.html?game=th11mp` on both
clients. Test memberships were released and temporary tabs/services closed.

The frozen TH11 Runtime generation used for this test is
`4c629ac48793a981cc74c6cc8ba2ca20496982ee7f1b2fedd656b2cb99cc2d6c`.
Observed native pause Return-to-Title behavior: P2 retired into the room, while
P1 stopped on a control-channel error and could use the recovery button to return
to that room. On 2026-10-11 the user clarified that one side returning and the
other side stopping is intended. The prior requirement that both clients exit
automatically was incorrect and is withdrawn. This behavior is not a merge
blocker. The missing `returnToMenu` marker remains an observed protocol fact,
not a requirement to force both players out of the room.

The synchronized candidate initially preserved main's outdated TH11 rule text.
On 2026-10-11 the user specified the final three TH11-specific player-facing
rules: ordinary P drops scale 2x/3x (not Full Power), Bomb invulnerability is
shared except for Marisa A (8.00 maximum Power), and shared life fragments drop
at the original 1x rate. The authored `content/MULTIPLAYER.md` and generated
HTML now use those rules; the generic P-drop exception no longer includes TH11.
All-seat/ghost dialogue advancement, P1-owned story selection, and transfers
during dialogue are multiplayer implementation invariants, not extra
player-facing rules. UI layout and the optional Always Hitbox are likewise
presentation requirements, not game-rule bullets.

TH11MP native presentation verification passed 807 checks / 376 native
logic-and-draw ticks: original life/Power atlas elements, local Graze below
the seat groups, local-only view selection, and Always Hitbox drawn only for
the local seat when enabled, without changing combat RNG, Focus, motion or
authoritative state. The original communication/point display remains in
the native lower-left location. Launcher content freshness, TH11 policy,
shared guide, and dialog regression checks also passed. These focused
checks do not replace a full browser/device run or the pending Linux CI.

Earlier all-title browser evidence is retained separately in
`.cache/ui-acceptance/report.json` and is not relabeled as acceptance of this
candidate. No new 3P/Extra/spectator complete run, mobile-device, forced TURN,
long-duration Replay, production cutover or formal release is claimed here.

Before promotion: obtain green full-suite Linux CI including the atomic-deployment
gate, then complete formal browser/release acceptance. The TH11 rule wording is
reviewed and synchronized locally, not yet published. One-sided return stopping
its peer is accepted behavior, not an outstanding terminal-flow repair.

## Site Manifest and compatibility

When offline support is disabled, `app-shell-sw.js` remains a canonical retirement
worker at the former script URL. Cached old Launchers authorize its activation
through their existing idle/gameplay/file-operation guards. It unregisters the
old scope and passes requests to the network without claiming other tabs,
forcing game navigation, or deleting caches, IndexedDB or localStorage. New
React pages do not register it. This compatibility endpoint must remain available
while old cached Launchers exist. `npm run test:app-shell-retirement:browser`
checks root and nested upgrades, deferred activation, concurrent old/new tabs,
and preservation of stored data using the committed pre-migration worker/client.

`site-manifest.json` with `eagler-touhou/site-manifest/1` is the current resource
contract. Product Catalog remains the static product authority; Release Catalog
continues to describe installable versions. Host remains the Runtime's host role.

Old schema/file readers and old operator-flag handling live in `compat/` and
`src/contracts/compat/`. The optional old `host-manifest.json` response is derived
from Site Manifest by one compatibility writer and verified against it; it is
not independently editable. Current browser reads use the new file first and
try the legacy URL only for HTTP 404/410. Invalid current content and network
failures do not silently select a different authority.

The current build compiles pure client services for Node checks, then emits the
React graph. It does not generate old card HTML or an old app/lobby module.
Bootstrap-only HTML fragments preserve the original loading and compatibility
surfaces. Common CSS is still shared with standalone help pages; moving styles
must retain the accepted production byte/cascade checks.

Public PR/review wording still requires the user's review. Commit wording is
exempt by the 2026-10-11 instruction and uses concise Chinese.


The redesigned multiplayer directory uses the same square `GameDirectory` as the
single-player workspace. A cover activates the existing directory filter route
once; `lobbyGameOptions` opens the existing settings modal separately. The
persistent `LobbySurface` receives all room rows, availability, membership,
loading, and recovery state from `LobbyDirectoryView` and its existing service.
Create/code entry keeps `DirectoryRoomDialog` and its original submission/return
ownership. The room list scrolls inside the desktop panel and uses compact rows
on narrow screens; the room-internal view remains the next migration stage.


The multiplayer workspace now keeps the launcher masthead, website entry,
game directory, and original SiteFooter in the same LibrarySurface instance.
`view=lobby` selects the directory inside the home document; standalone
`lobby.html` remains an alias. Its bottom-left return link restores the selected
single-player product, and the website entry requests the real directory's
unfiltered room list. Query-independent initial HTML avoids prerender hydration
mismatches; the startup owner retires the root watchdog for the workspace mode
and does not conceal shared chrome during warm mode changes. Multiplayer
settings retain the original modal field owner.


### Room redesign presentation

Production RoomComposition opts into RoomWorkspace while retaining the original MultiplayerRoomService, network, panels, relocated settings and Runtime nodes. The shared LibrarySurface hosts the room card and credits. Grouped character/shot presentation maps to canonical native loadout indexes, including TH08 solo entries and TH09 ordering. A capable relay now owns the directory lock and selected product: the host may unlock and switch games in the same logical room, keeping its number and member identities. Legacy relays retain the locked presentation with an explicit compatibility hint.

Forward card motion uses the existing Router blocker, comparing the Router's current and next route identities even during layout-time invite normalization. User room departure animates before calling the existing cleanup port and holds the old card offscreen until its DOM node is replaced, with cancellation and a timeout. Runtime/title-overlay departures preserve their original cleanup path. No duplicate room, settings, file session or game iframe is created.

The selected-product directory creates a real room immediately with fresh defaults; only an unfiltered directory needs a product chooser. Room toolbar controls share the launcher/notice button styles and site tokens. On narrow/portrait screens the title and idle-connected label are hidden. Toolbar controls share one row when space permits; the privacy/code pair wraps together to a second left-aligned row when needed. The directory room card grows with its two or three seat cards and has no inner vertical scroller. Vertical touch gestures scroll the page; horizontal swipes and taps retain character selection. Desktop and runtime overlay sizing keep their existing rules. The room's More dropdown and its entries are removed at the user's request; the masthead now opens global SettingsWorkspace, while seat profiles and native player settings retain their existing owners.

### Switchable room protocol

New clients opt in with `roomProducts=1`; the relay advertises `roomDirectory.roomProducts=1`. Snapshots carry the current `product`, `directoryLocked`, `productVersion` and collective `productSwitchAvailable`. The host sends `directory-lock` or `set-product` against the observed version. Ordinary configuration/resource requests are also versioned once capability is negotiated, so delayed work cannot mutate the next game's room state.

`server/room-products.mjs` moves the canonical transport key to the selected product while preserving the room object, number, sockets, seats, spectators, directory memberships and quota ownership. Previous invite keys remain aliases until deletion. Gameplay continues to use the current product's original transport/runtime contract. Switching is rejected outside the lobby, while locked, for non-hosts, while clients are busy/incompatible, or while gameplay transports are active. Incompatible third seats become spectators, with a client notification; readiness, loadouts, resources and timing reset to the new product's policy.

The client aborts the previous preparation/operation epoch without retiring its lobby socket. Identity adoption and per-title session records preserve reload/reconnect ownership. Switchable session records allow an old invite hint to find the latest room record; desired seats are reclaimed only after receiving the authoritative snapshot. Router replacement changes the invite's product without adding navigation layers. Directory activation is routed to the room service, and global directory shortcuts ignore focused room controls. Settings/editing presence temporarily blocks remote game changes.

Deployment requires the updated relay as well as the client. Local acceptance now uses the user-facing frontend on `127.0.0.1:8138` and relay on `127.0.0.1:8139`; `8140` is an optional preview of the same build. The preview manifest points to the local relay. Public rooms on touhou.vip are separate and production has not been updated.


### Room cards, preparation and host identity

RoomWorkspace displays the existing automatic preparation stream inside each occupied seat: a bottom capsule, determinate download percentage when available, an indeterminate runtime/import phase, completion, and retry on failure/cancellation. Peer capsules use relay resource reports. Choosing a character and completing preparation are both required before Ready. New clients request `roomCards=1`; capable relays advertise `roomDirectory.roomCards=1` and reject Ready before that client's resources are ready. The unmodified legacy room presentation/service contract remains compatible with older relays; the redesign always applies its local loading gate.

Snapshots expose an authoritative `hostClientId`, independent of P1/P2/P3. Settings, start authorization, directory lock, game switches, and player/spectator removal follow that identity. The lobby owns host reassignment after departure; reload/page suspension uses reconnect grace and preserves ownership. Native timing publication and gameplay P1 responsibilities remain assigned to gameplay P1. Older relays without an owner field retain their original P1 permissions.

The host can remove either other empty slot when capacity is three using `remove-seat` with the observed `settingsVersion`. The relay requires an empty target and current owner/version, compacts remaining seats to two and invalidates ready state; it never drops an occupied P3. Kicking an occupied seat remains a separately confirmed action and cannot target the host. Desktop card controls appear on hover or keyboard focus; narrow/touch layouts keep them visible.

Each client reports only a coarse `deviceType` (`desktop`, `phone`, `tablet`) when joining a seat, distinct from its control mode. The full user agent is never sent. Unreported peer types show an unknown-device icon. The end button opens the existing personal/network panel. Room-specific ID-scoped rules override legacy minimum button heights and external focus outlines so device/remove buttons remain circular and the card focus ring stays inside its border.

These changes require the updated relay for independent host identity, arbitrary empty-slot removal and peer device reporting. Local acceptance uses relay 8139 with both previews 8138 and 8140; neither local preview relies on the older upstream service.


### Room card selection and progress follow-up

The redesign bottom row contains a flexible progress capsule and a separate circular device button. Resource readiness alone is no longer labelled Loaded: the local card says Choose character and peer cards say Choosing character until their loadout has been confirmed. Confirmed + runtime ready yields Loaded; ready yields Ready with green fill. Failures and disconnected states take precedence.

The relay advertises `selectionState: 1` alongside `roomCards: 1`. New clients extend `set-loadout` with optional boolean `selectionConfirmed`, broadcast on seats. The service waits for both loadout and confirmation acknowledgement before enabling Ready, and recovers confirmation from authoritative snapshots after remount/reconnect. Changing loadout, moving seats or changing product resets confirmation; explicit false prevents ready for opted-in seats. Legacy clients that never send the field retain their existing flow; old relays receive the original payload and cannot synchronize peer confirmation. Deploy the matching relay for the complete behavior.

### Retained room return and explicit dissolution

Host Return to lobby now parks the room without releasing its browser membership, identity, seat, loadout or preparation. Guests still leave normally. The directory's existing red primary action changes to Return to room while a membership exists, using the authoritative product/code and adopting the private member's original lobby client identity before navigation; it never runs the create flow or clears the saved session. Parked room closure only notifies an already-returned host, avoiding a surprise redirect from another launcher view.

The paired relay advertises `roomRetention: 1`. Host-only `park-room`, `resume-room`, and `dissolve-room` controls use the existing product version and lobby-phase guards. `retainedHostId` keeps ownership across page suspension past the reconnect grace; private directory `mine` adds the associated `clientId` and `retained` flag. Neither value grants membership without the existing private member credential. Existing idle expiry and explicit membership recovery still apply. Starting/changing product is blocked while the host is parked.

Dissolve room is adjacent to Return to lobby and uses the shared danger decision dialog. Only confirmation requests the exit animation and relay command. The relay removes all lobby memberships/seats, reconnect timers and idle runs, forgets room aliases, and closes affected clients with 4011. Clients return with Room dissolved feedback; old invitations cannot recreate it. An active game transport prevents dissolution. Old relays retain the host only while its document/socket is alive and disable the unsupported dissolve action; deploy the paired relay for the complete flow.


### Lobby toolbar, scrolling and confirmed room replacement

The lobby header uses existing capsule buttons for How to play, Check network, Survey and icon-only Refresh, all on one line. Global Settings retains game-options access. The card has bounded viewport-relative height; only the room-list body scrolls, with a sticky desktop table header. Focused list/toolbar keyboard events are excluded from game-directory shortcuts. The browser-membership banner has been removed; the primary action still returns to the current room.

The directory advertises `roomSwitch:1` and exposes `mine.host` only to that private member. `switch-room` carries a positive requestId, the exact observed recoveryToken, destination product/code and whether the caller expects to dissolve its owned room. The relay validates current ownership, source waiting/no-game state and an available waiting destination before changing membership. A host dissolves the source and notifies peers; a guest only releases its own seat. Success/failure is returned as a correlated `room-switch-result`. No seat reservation is made across the subsequent client connection; normal room-entry failures still apply if the destination changes afterward.

The directory service uses the shared decision store for confirmation, including joins by code after the code dialog closes. Cancellation, stale membership/socket, unavailable target and unmatched reply cannot navigate or release the source. After a matched success, the browser session retires the old parked service before navigating, so its late socket close cannot affect the new room. Older relays do not advertise the capability and receive no unknown switch command. The matching local relay on 8139 supplies full behavior to the user-facing 8138 preview and optional 8140 preview.


### Inline room-code entry

The redesign footer expands its code button into a local input/arrow form; no Router dialog entry is created. CSS width/opacity transitions respect reduced motion. Visibility switches synchronously so focus can move immediately; Escape cancels lookup and restores trigger focus. The visible room-count eyebrow is removed, while the screen-reader live count remains.

`roomLookup:1` on directory snapshots enables `resolve-room {requestId,code}`. The relay checks all canonical room keys, including private or idle-hidden rooms, and responds with `room-lookup-result {requestId,code,ok,product? ,reason?}` without joining or returning player details. Ambiguous legacy codes are rejected instead of choosing a product. Full/playing targets are rejected except for returning to the member's own room; requests are throttled per directory connection. The service validates advertised products and correlated responses, cancels stale lookups on departure/Escape/disconnect, and delegates successful results to the existing confirmed join path. Room navigation selects the resolved product through the existing Router/card transition; no separate animation or duplicate room owner is introduced. The matching relay is required for private/unlisted cross-product resolution.


The masthead brand is now a native button with a fixed subtitle slot.
`MastheadBrand` owns a document-local ten-click counter and a reversible
subtitle sequence: update-age exits upward, the linked Grass1337 visit enters
from above, remains fully shown for2 seconds, exits upward, then the current
real update-age enters from above. The original time node/store is retained,
clicks during the sequence are ignored, and timers are cleaned on unmount.
Reduced motion removes movement but retains the2-second interval. Its link
shares `grass1337CreditHref` with the unchanged footer credit. Header brand
and actions are larger;320px Chinese uses narrower icon buttons and a two-line
FAQ label to prevent overlap. Very narrow English may use a second Header row.


Desktop site, game and settings cards now share `launcher-workspace-layout`: one
viewport frame, one full-width row of credits with the gradient divider, and a
stable max-content Header row. The Header remains at the top when longer desktop
content scrolls. The sheet clips card-exchange overflow so animations cannot grow
the page or shift the Header. Site status rows are hidden when empty; notice
content fits inside the frame, while portrait content keeps normal page flow.
The site title is the return-focus target after removing its refresh button.

The desktop category dock uses the actual sheet gap below the Header, matching
the workspace top.110px rail padding/scroll padding protects the first enlarged
site cover. Rear category choices scroll to the game rail's horizontal center,
including repeated clicks on the active choice. Trailing scroll space permits
the final option to reach that point.

Directory groups retain their cover images and hide out-of-scope groups.
`visibleDirectoryEntries` excludes hidden ancestors for waves, centering and
keyboard activation; hidden game links cannot activate even through synthetic
clicks. This avoids recreating and reloading images when categories change.
The ignored local preview additionally caches the seven published covers in
`.cache/redesign/cover-cache`, serves them with a one-hour browser cache and a
content ETag, and returns304 for matching conditional requests. This preview
cache does not change the canonical catalog or Host-generated artwork owner.


Room settings presence now uses a separate capability-negotiated editing-state
field, independent of Runtime resource progress. RoomWorkspace derives it from
settings/touch/game-panel visibility. Entering clears only the local player's
Ready; the relay independently enforces that rule and refuses Ready while
editing. Both players' progress labels display Changing settings, then return
to the actual resource/selection status when the settings view closes. Progress
percent and choice are retained; Ready requires another user action. Reconnect
and seat changes resend the view state, while socket close clears its transient
server marker. SettingsWorkspace omits the legacy tools class so room-mode
styles cannot hide the main settings card.
