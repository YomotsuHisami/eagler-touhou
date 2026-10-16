# Multiplayer Playbook

Status: active

## Purpose

Route multiplayer, rollback, spectator, MP Replay and MP Launcher work without reviving the withdrawn early multiplayer path or mixing network transport, deterministic simulation and product packaging.

For rollback **optimization** rather than multiplayer architecture, use
`rollback.md`. It preserves the complete TH07 journal/input/snapshot/mobile
optimization exploration, including failed experiments and zero-delay evidence.

## Applicability and authority

Multiplayer implementation and rollback/netplay experiments must use a topic
worktree separate from upstream tracking and the canonical Eagler integration
worktree. Promotion follows
[Adaptation Worktree Isolation](adaptation-worktrees.md).

- TH08 and TH10 keep ordinary `eagler` and Multiplayer implementation histories
  permanently separate. Both repositories use `eagler-mp` as their persistent
  MP source branch. Keep this branch separate from `eagler` and retain it after
  shared fixes have been transferred. Their Runtime owners remain the
  canonical `th08-eagler` / `th10-eagler` repositories. Select the branch for the
  requested product before changing or building source. Carry shared fixes
  across with individually reviewed commits where applicable, preserving each
  target's ancestor and gameplay contract. Never merge the complete MP
  implementation into the ordinary branch or replace an ordinary Runtime with
  an MP build. MP topic integration targets the corresponding MP branch.
- TH06MP and TH07MP provide the reusable architecture and test evidence for the
  products that currently declare Multiplayer. TH09MP uses native two-player
  character/difficulty selection and its title-specific rollback/delay session
  over the shared `eagler-common` browser transport. Products declaring
  measured startup select pure delay or hybrid rollback before frame zero;
  see [Measured Multiplayer Startup](adonis-adaptation.md).
  TH09MP publishes complete match initializers and confirmed two-player input
  through the shared relay. Spectators start at the current match's gameplay
  frame without taking a player seat. Native menu frames stay outside that
  history. The room facts stay in `product-catalog`.
- TH09MP touch movement ships the gesture's absolute field target (motion modes
  2/3 of its input frame) rather than a velocity sampled on the sending machine,
  and the Launcher keeps game keys flowing from the realm that owns focus.
- Titles that do not declare `multiplayerRuntime + multiplayer` are outside
  this profile; do not describe that absence as unfinished adapter work.
- Multiplayer itself is an **optional product capability**. Once a product
  declares `multiplayerRuntime + multiplayer` in the shared product catalog,
  the profile-required Multiplayer behaviors are mandatory; do not add a
  second per-title feature switch for them.
- Browser transport claims come from reproducible transport and Launcher tests. A room connection or focused browser PASS is not human cross-device acceptance.
- In cooperative multiplayer, only the selected local viewpoint's hitbox may
  be displayed (native focus marker and optional always-visible marker). Filter
  rendering only: keep native animation updates, collisions, RNG and recorded
  inputs unchanged. Retain ownership through marker fade-out; do not hide the
  teammate character, options, shots or bomb effects. Replay/spectator views
  use the same selected-viewpoint rule. This rule does not change TH09's versus
  presentation.

<!-- knowledge-id: K-MP-001 -->
## Normal design

For products declaring `inputTiming.measuredStartup`, follow
[Measured Multiplayer Startup](adonis-adaptation.md) for pure/hybrid timing,
frame-zero calibration and acceptance. The zero-added-delay policy below is
specific to TH06MP/TH07MP.

Treat ordinary and MP variants as separately identified products whose
relationship comes from `product-catalog`, not from title-number branches.
Use separate runtime/build identity, URL or package identity, room/session state
and Replay semantics where required. Shared UI/service helpers are the default;
product facts such as loadout/difficulty bounds stay in the catalog.

The TH07MP reference layering is:

1. protocol: version, HELLO/READY, frame numbering, input, confirmation and targeted relay envelopes;
2. synchronization: deterministic simulation, input prediction, bounded rollback and Stage/Result lifecycle;
3. transport: WebRTC full mesh with WebSocket fallback and separate control/input semantics;
4. browser: signaling, ICE/TURN, reconnect and route state;
5. game adapter: the owners for GameManager, Enemy, Bullet, Item, Effect, ANM, ECL, Replay and input.

Use a frame-0 barrier, bounded direction prediction, confirmed frames, limited catch-up and a sparse/fixed-arena journal. Full-world snapshots were measured at roughly 19 MB each and are not a per-tick transport strategy. Relay forwards targeted envelopes; it does not simulate the game.

For the current TH06/TH07 production profile, there is one player-facing timing policy: zero added local input frames with full rollback on every endpoint. The generic netplay core may retain input-delay primitives for tests and future evidence-backed designs, but the shared Launcher does not expose a title-specific buffered/stability mode. Do not reintroduce the retired TH07 mobile/desktop asymmetric policy merely for backward compatibility.

Spectators consume confirmed history without taking a player seat or submitting gameplay input. TH09 timeline rooms allow late join and local playback pause/seek; those controls cannot alter the players' simulation. Other rooms retain their advertised admission policy. Runtime exit must not accidentally destroy an active room that Launcher still owns.

<!-- knowledge-id: K-MP-002 -->
## Invariants and pitfalls

- One logical frame samples input once. Retransmit, retry and prediction never resample a device.
- A lockstep payload must not carry a value derived from the sender's simulation
  state at send time. Sampling happens `lead` frames before the frame that
  applies it, so a derived velocity aims from a position the receiver has not
  reached: TH09's touch gesture shipped that way made a dragged player orbit the
  finger forever. Ship the absolute target (or sample on the applied frame) and
  let every peer derive the frame-local value identically.
- Delivery, prediction, confirmation and rollback each have explicit owners.
- Restart creates a new generation/session identity; a visible canvas is not proof that transport is healthy.
- Reconnection waits are bounded; an ICE restart requires missing health or confirmation progress, not just a transient `disconnected` state.
- MP Replay uses the documented local-player offset and isolated MP storage; do not infer ownership from visual seat position.
- Keep rollback/presentation separate. Remote smoothing and alpha are draw-side; rollback changes logical state only.
- Do not restore the withdrawn `TH_ENABLE_MULTIPLAYER`, `MultiplayerRuntime.*`, `g_Player2` or old LCConnect path.
- Do not add or expand hash-based gating to hide a semantic mismatch. Compare the divergent owner/state and preserve existing correctness checks.
- Relay/TURN is shared service infrastructure. New configuration uses the
  `EAGLER_NETPLAY_*` namespace. Historical `TH07_*` relay/TURN variables are
  compatibility aliases only and must not be copied into a new title-specific
  namespace.
- A diagnostics/fallback room is product-neutral. Do not encode `th07mp` (or
  another title) merely to reach shared signaling/ICE health checks.

## Superseded approaches

The early TH06 LCConnect/`MultiplayerRuntime.*`/`g_Player2` route is withdrawn. Full-world per-tick snapshots and decorative rollback state are also superseded by bounded sparse ownership and logic-only rollback.

## Code and system anchors

### Public room directory

The React `lobby.html` route is a separate directory page; the launcher's Multiplayer
shelf links to it. Each supported game's options panel links to `lobby.html?game=<mp-product>`
using the catalog's game-to-Multiplayer mapping. The directory keeps that filter.
The Launcher and directory opt into a short native document crossfade, including
history navigation where supported; room transitions use one surface without
nested dock entry animations. Reduced motion suppresses both.
Room departure commits immediately for both the return button and system Back;
the destination animates without waiting for an outgoing-room fade timer.
The room button invokes departure directly, without waiting for `history.back()`
or `popstate`. Directory returns replace the URL with the matching game's lobby;
`document.referrer` cannot identify the preceding entry after settings/panel
navigation. Options returns clear panel history flags and modal/inert state.
The directory reveals its first screen only after a relay result (or explicit
connection failure) and critical fonts/background/visible covers have settled,
with a bounded visual wait matching the Launcher. Initial rows do not replay
their insertion animation at reveal. A standalone preload failure surface keeps
reload/back available if the page module fails to load.
`app/services/lobby-directory.ts` consumes real relay snapshots.
`app/components/directory/` renders the shared directory components and uses the
React room route for creation/joining. Browsing the
directory never creates a room or takes a seat. No generated mockup is shipped
as a UI asset. Both the page and its dependency closure belong to the sealed React artifact.

P1 can select public/private discovery and disallow unlimited-speed touch
movement. Private means hidden from the directory, not password protection;
room-code joins still work. Creation applies these rules before the first
snapshot, including a private host whose seat is pending a movement change.
Changing the movement rule invalidates readiness. Restricted rooms require an
explicit permitted movement mode at seat admission, readiness and game start;
the Launcher offers normal touch / joystick in the shared decision dialog and
blocks switching back to unlimited movement while seated. This is a client
settings agreement enforced by the relay, not anti-cheat against modified clients.
Player avatars show a compact control-mode caption in both room and directory:
unlimited touch / touch / normal (touch disabled or either joystick mode).
The relay derives this from declared touch settings, advertises support, and
publishes updates. Empty seats and legacy peers with unknown settings have no caption.

`server/room-directory.mjs` is owned by the shared netplay relay. The same relay
URL from Site Manifest accepts `?directory=1&member=<anonymous-browser-id>` and
sends version-1 `directory` messages. Snapshots expose room code/product,
capacity, occupancy, difficulty, ready status and spectator count. With public
nickname moderation enabled, rows declare `publicNames: true` and seats include
the complete approved `name`; otherwise they retain the legacy initials-only
format. They always exclude internal client IDs. `refresh`
messages optionally select a product; responses are bounded to 200 rooms.
Snapshots echo the selected `product`. The directory shows a loading indicator
until the requested filter's snapshot arrives, and only then shows an empty
state when there are no rooms. Earlier filter replies cannot settle a new filter.

Public nickname authority lives in `server/public-nicknames.mjs`, reached through
`nickname-service.mjs` and a dedicated worker. SQLite and provider requests never
run on the relay event loop. Enable `EAGLER_NETPLAY_PUBLIC_NICKNAMES=1` with a
private absolute `EAGLER_NETPLAY_NICKNAME_STATE` and server-only
`EAGLER_NETPLAY_NICKNAME_API_KEY`. The provider receives only the normalized
nickname. `EAGLER_NETPLAY_NICKNAME_API_BASE` selects a server-owned HTTPS
OpenAI-compatible base (including a `/v1` path when required); credentials,
query parameters, fragments, HTTP and redirects are rejected. Requests disable
thinking and cap output at two tokens. Exact normalized
spellings share durable approval/refusal results; incomplete/provider-error
responses never approve a nickname. Review uses the context of publicly displayed
game nicknames in mainland China. Political figures, political propaganda and
related disguises are refused alongside abusive/sexual/scam/official-impersonation
names. `server/nickname-policy.mjs` owns the prompt, policy version and a small
deterministic reserved-name guard. Changing that policy version quarantines old
cached approvals and existing profile names until re-reviewed; a quarantined
name cannot retain its old rename cooldown or appear in public snapshots.
The normalization contract is
`src/contracts/public-nickname.mts` (NFKC, no control/format characters, at most
12 code points).

`nickname-status` advertises review support and returns the existing approved
name, status and deadlines. An owner-only `pendingName` accompanies `queued`;
never use that private draft as a room, directory, score or chat display name.
The client then migrates its saved draft
using `set-name`. Role messages cannot publish their proposed names: seats and
spectators use the server profile. While review is pending or refused, keep the
old approved name, or an empty name rendered as P1/P2. Directory, room roster,
spectator list, score and quick chat consume these authoritative names. Do not
publish the unreviewed legacy machine-sign field in public-name directory rows.
Render full names as text and allow wrapping on narrow screens.

Fresh submissions are acknowledged after SQLite has durably queued them; the
browser never waits for the provider. One pending task per anonymous member is
idempotent across refresh and reconnect. The private queue stores HMAC member/IP
keys, is bounded to 1,000 tasks and preserves work across service restarts.
The worker drains one task at a time. Provider failures pause the whole provider
queue for 30 seconds, doubling to at most one hour; the pause survives restarts.
Each source may spend at most 30 provider attempts per day, including retries,
within the shared 1,000-attempt daily budget. Retries never consume another IP
submission or user refusal attempt. Commit a final verdict/profile update and
dequeue in one SQLite transaction, then push the owner status and approved
public name to online rooms. Offline members receive the result on reconnect.
Jobs are claimed atomically with a one-minute lease. Completion checks the
lease, preventing overlapping workers from charging one refusal twice. After a
crash an unfinished claim becomes available again. An upstream request that
completed immediately before a crash may still be repeated: remote API calls
and the local transaction cannot provide exactly-once billing.
The personal panel keeps input and submit together, shows a compact pending
status, and remains closable while background review runs.

The first accepted name permits one immediate change. A later accepted change
starts a persistent 24-hour browser-member cooldown. A declined review leaves
one final retry, tracked for 24 hours; that retry starts a 24-hour cooldown
whether accepted or declined, including a first-ever name accepted on the final
retry. Provider outages do not consume retries. `attemptsLeft` exposes one/zero
remaining retries (or null when no refusal is active). SQLite schema migration
preserves existing approved names and grants the initial immediate change.
Default abuse limits are five
submissions per source/hour, 20 per source/day, and at most 20 pending tasks per
source. IPv6 addresses share a /64 source bucket; mapped IPv4 spellings share the
IPv4 bucket. Before worker admission, nickname messages are limited to ten per
source per ten seconds. Repeated approved names and queued submissions return
the cached owner state without SQL or public room broadcasts. Publication uses
the existing membership index to reach only the member's current room.
Member and source keys use salted HMACs in SQLite.
The anonymous member credential is not an account: clearing browser storage or
changing devices can create another identity, so IP and global limits remain
independent. These controls bound costs and reduce single-source abuse; they
cannot distinguish a legitimate new anonymous browser from a distributed bot.
Preserve the database on restart. The 50,000-entry verdict cache evicts its oldest
entries in batches. Each approved profile retains its own policy version so
cache eviction does not hide a public name. Profiles are capped at 500,000;
capacity is checked before a paid request. Indexed maintenance removes expired
quota rows and nameless refusal profiles, in batches of at most 1,000 per minute,
even if no nickname is ever approved. Provider responses are streamed with a
16 KiB byte limit and unwanted response bodies are cancelled immediately.

- The new Launcher shares one anonymous local-storage membership ID across
  titles and tabs, while retaining per-tab client IDs. The relay rejects a
  second active room/tab (4009); an exact-session reconnect replaces the prior
  socket (4008). This prevents accidental multi-tab occupancy, not deliberate
  bypass via another browser, cleared storage or a legacy client.
- Directory navigation uses explicit `create`/`join` intent. Creation conflicts
  and vanished join targets fail with 4007 instead of recreating stale rooms.
- Socket ping/pong runs every 30 seconds, with the next missed heartbeat
  terminating the connection. Existing room reconnect grace remains 12 seconds.
  An explicit departure releases the seat immediately.
- A force-closed mobile page may retain a server-side socket until heartbeat
  expiry. The directory provides an explicit “leave old room” action scoped to
  its anonymous member and the exact observed session token. It releases that
  member's seat, spectator admission and game/signaling transports, never another
  member or a newer session. The page unlocks only after server confirmation;
  old relays show a compatibility hint rather than pretending to release locally.
- Waiting rooms with no action for 5 minutes are hidden; after 30 minutes they
  are closed (4004), with maintenance running every 30 seconds. Room operations
  and throttled trusted interaction refresh activity; network probes/heartbeat
  do not. Live game/signaling/spectator transports are exempt from idle expiry.
  Returning from a completed game starts a fresh waiting-room activity window.
- Room activity is sent only after the relay advertises `roomDirectory.version`
  in its handshake, so old relays remain compatible with the normal room UI.
  An old relay cannot serve the directory: the page displays that limitation.
- Publishing the frontend alone is insufficient to enable room discovery.
  Ship the updated relay together with `room-directory.mjs` and activate it in
  the service's normal maintenance window. Do not restart a live relay as part
  of frontend preview work.

The directory's form sheets own a browser-history entry. Entering a room closes
that entry first; both the room return action and system Back lead to the
directory. Room sessions and shared room settings remain owned by the Launcher.

### TH09 native match selection

TH09 declares `inGameSelection` in the product catalog. The room owns seats,
readiness, transport settings and spectator admission. Each player selects and
confirms their own character in game. Both players operate difficulty and stage;
character navigation and confirmation stay separated by player side. Native
health and palette choices stay in the game's menus. The result menu returns to
selection without replacing the room, run or transport.

Launcher passes `netplayInGameSelection` to players and spectators and hides
room character/difficulty controls. Spectators wait during initial selection.
T9BG/2 carries complete scalar match settings plus RNG and menu edges in a
102-byte packet. The first gameplay frame may be nonzero because menu input is
excluded from the match stream. Relay retains the latest initializer for late
join. V1/74-byte initializers remain compatible. A paused viewer retains the
old match tail and queued next match until playback advances or go-live is
requested. Each v2 initializer constructs a world independently, including Retry.

Reversible selection frames use the normal rollback window. Their checkpoint
includes menu state, both input histories, settings, RNG, animations and stage
choices. Resource setup, world construction and transport departure still wait
for reconciled input. Do not block every menu animation frame on network RTT.
The difficulty and stage menu input combines both players; character selection
continues to consume the two separate inputs.

Main frontend acceptance: `tests/browser/test-th09-in-game-selection.mjs` runs
the actual React room, Release managed Runtime, independent selection, natural
match completion, character changes, a paused spectator and a late spectator.
Its optional `TH09_SELECTION_RUNTIME_PATH` is a test Site Manifest override.
`tests/react-main/th09-in-game-selection.test.mjs` covers room/directory controls
in Chinese and English and retains TH06's room-selection behavior. Record local
browser evidence separately from physical-device or public-network acceptance.

TH09 spectators retain their own received confirmed packets locally until they
leave. A complete v2 initializer permits restoring an earlier match in the same
viewer and re-simulating to a fixed target without reconnecting. The timeline
joins gameplay input counts, excluding menu gaps, and distinguishes match marks
from round marks. Rebuilding a world does not move the visible thumb to zero.
This does not expand late-join bootstrap: the relay still replaces its history
at every match initializer and sends a new viewer only the current match from
its start. Earlier local matches belong only to viewers who received them.
`tests/test-th09-spectator-history-relay.mjs` verifies this admission boundary.

### Existing multiplayer anchors

- sibling `eagler-common/`: shared cross-title netplay/runtime authority.
  Generic session, transport, core, input ownership, journal/rollback storage,
  browser catch-up/time-sync pacing, confirmed-frontier liveness and reusable
  fault-injection primitives converge here. Title repositories retain small
  protocol/input/transport config seams, rollback-state inventories, canonical
  hashes, gameplay lifecycle and title acceptance fixtures. Do not build a
  universal title driver merely to eliminate a few lines of adapter glue.
- `src/contracts/product-catalog.mts`: optional Multiplayer
  declarations and per-product room/loadout bounds.
- `src/contracts/adapter-capabilities.mts`: profile-required
  Multiplayer obligations and legacy compatibility classification.
- `server/netplay-relay.mjs`: shared relay policy; derives room
  product policy from the declared product prefix and uses generic service
  configuration.
- `src/launcher/multiplayer-relay-url.mts` and
  `network-diagnostics.mts`: shared transport URL/diagnostics ownership.
- `tests/test-netplay-relay-product-policy.mjs` and
  `test-netplay-service-config.mjs`: product-policy and deployment-namespace
  gates.
- `tests/test-th09-mixed-entry-launcher-browser.py`
  (`npm run test:th09-mixed-entry:browser`) and `tests/test-th09mp-launch.py`
  (`npm run test:th09mp-launch:browser`): TH09 room interop in both directions
  (in-game title dialog hosting the Launcher card joining, and the reverse) and
  a real two-Runtime versus match over the shared transport, respectively. The
  launch gate runs the muted music path too, and can take its content from an
  offline package with `--package-zip=PATH`.
- `tests/test-multiplayer-spectator-launcher-contract.mjs` and
  `tests/test-multiplayer-replay-launcher-contract.mjs`: Launcher product
  contracts.
- TH06MP/TH07MP title repositories: title-specific rollback inventories,
  gameplay semantics and transport acceptance evidence.

## TH09 local match Replay archive

TH09MP defaults to automatically saving each completed versus match. The local
player can disable it in the top-right local game settings, above the Replay
viewer/import actions; the preference is stored
per product in that browser. Spectators and unfinished/disconnected matches do
not produce completed-match archives.

The Runtime archives both players' reconciled match-end boundaries, once per
match, including repeated matches over the same connection. Individual rounds
do not trigger a save. Encoding uses local random bytes without advancing the
simulation RNG. Failed storage must report a notice without closing transport.

New native archives use `replay/<opponent name>/th9_udhhhh.rpy`, falling back to
the opponent's `P1` / `P2` label. Local side and both names are captured when the
match begins. Existing directories are not migrated. Continuous-touch recordings
export as `.rpyx`. A same-basename JSON sidecar snapshots both display names,
start time, confirmed frame duration and winner. Optional `roundStarts` holds
ascending Replay input offsets starting at zero, bounded to ten rounds. The
native driver publishes these offsets only from confirmed frames on both
players; network/menu ticks are not used as seek positions. No membership
credential is stored. Sidecars survive ZIP import, rename and move.

The Replay seekbar marks these offsets and supports clicking them in either
direction. Original files without JSON remain playable; native playback exposes
the current round, allowing the viewer to learn boundaries as it plays or seeks
and retain them across rewinds of that file. Character labels reuse the catalog's
original TH09 character IDs. The manager preserves actual directories without
adding a route. Persistence is local browser storage, not a server upload.

Code owners: TH09 `sdl-runtime/auto-replay.mjs` and confirmed publication in
`cpp/sdl/Application.cpp`; Launcher `MultiplayerSettingsControls`, `multiplayer-preferences`,
`th09-replay-match`, Replay model and file actions.

## Verification

Check in this order:

1. ordinary/MP build and storage identity are isolated;
2. protocol/version, frame-0 barrier, input ownership and prediction bounds;
3. 2P and 3P core, restart/death/Result, Replay and spectator backlog;
4. WebRTC, WebSocket fallback, Relay/TURN candidate and route state;
5. Launcher card/room/exit behavior;
6. browser-focused evidence, then clearly labeled human/device evidence.

Record first divergent logical frame and owner state. Do not substitute a screenshot, a room join or a source-only contract for end-to-end acceptance.

When the failure is performance rather than protocol/lifecycle, follow the
measurement order and exact-byte/canonical gates in `rollback.md`; do not infer
rollback cost from average FPS alone.

## Deliberately omitted claims

This playbook does not make multiplayer mandatory for a title and does not
promote focused protocol/browser tests to cross-device human acceptance.
