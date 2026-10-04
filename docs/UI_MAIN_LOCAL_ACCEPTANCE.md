# UI main: local startup and Stage B acceptance

This guide applies to `experiment/ui-main`. See [scope and architecture](UI_MAIN_REBUILD.md).
The independent resource, Replay, settings and general published singleplayer
flows are being migrated. It is not a complete launcher or a production release.
Original-game and phone acceptance, remaining capability parity, and Stages D–E
remain incomplete. The TH06 artifacts below also work with the general launch
entry; select Japanese and no music when using only this bounded asset set.

## 1. Source-only startup

Use Node 24, the tested/CI version, and run from the repository root:

```sh
node --version
npm ci --ignore-scripts
npm run check:ui
npm run preview:ui
```

Open `http://127.0.0.1:4173/` in an isolated test browser profile in an environment
where browser execution is permitted. `check:ui` runs type checks, ownership
boundaries, Node routing/service tests, and the SPA build. It does **not** run
Playwright or an original game. Output is `.cache/build/ui-main/client`.
The preview is loopback-only; stop it with Ctrl+C. For source iteration,
`npm run dev:ui` uses `http://127.0.0.1:5173/`; use the built preview for acceptance.

There is no rendering-server requirement: React Router builds a static SPA
(`ssr: false`, with build-time root prerendering). The preview server is a local
static-file tool. It neither deploys nor registers a Service Worker. Use a fresh
profile so an existing worker, installed Package, or save cannot mask a failure.
Do not change the production worker, origin, entry, or user storage for this check.

A normal code checkout lacks the original game DATA, shared game fonts, and
complete Runtime publication. In that checkout, an explicit unavailable-resource
message and disabled preparation are expected. Missing JS/WASM must return 404,
not the SPA HTML. UI availability does not imply game availability.

## 2. Synthetic browser / CI evidence

Only in an authorized browser environment, after `npm run check:ui` succeeds:

```sh
npx playwright install --with-deps chromium firefox webkit
npm run test:ui:browser
```

Stop the manually started preview first: Playwright owns ports 4173 and 4175 and
does not reuse an existing server. The runner builds `.cache/ui-main-harness` for
the synthetic close-control and motion fixtures; that harness is separate from
the UI deployment output. Reports/screenshots/traces go to
`.cache/ui-main-report` and `.cache/ui-main-results`.

[The branch workflow](../.github/workflows/ui-main.yml) specifies Chromium,
Firefox, WebKit, and an iPhone 13 **viewport preset**. Close-control fixtures use
a fake service and empty iframe; Node acquisition tests use synthetic metadata
and bytes. None proves original gameplay, save durability, physical-phone
compatibility, or phone performance. Check the exact revision's CI result rather
than treating the presence of a workflow or this guide as a pass.

Browser execution was denied in the current cloud environment. It was not
retried through another browser route. The commands above are instructions for a
permitted environment, not a record of a local browser run. Original-game and
physical-phone acceptance remain unverified; the actual phone/browser version
is unknown. Record it before making a support claim.

## 3. Mount existing private TH06 artifacts

Use an existing, matching publication produced by the project's established
Host/Package/Runtime process. This guide does not generate or reconstruct game
artifacts. Keep original data, game fonts, and compiled game builds **outside
Git** and outside the UI output; an explicit mount is not publication permission.

After building the UI, replace the placeholder with that external directory:

```sh
npm run preview:ui -- --assets-root=/absolute/path/to/private-publication
```

The directory is served at the same origin as the sample, preserving publication
paths. A typical root-level TH06 Package publication contains:

```text
host-manifest.json
release-catalog.json
runtime-manifest.json
th06.package.json
games/th06/th06.data
shared/msgothic.ttc
shared/unifont.otf
runtime/th06/<generation-sha256>/th06.html
runtime/th06/<generation-sha256>/<every file declared for that generation>
```

Use the actual catalog/manifest paths, not invented filenames or placeholder
hashes. In particular:

- Host must publish TH06, `shared.runtimeManifest: "runtime-manifest.json"`, and
  a same-origin immutable normal Runtime entry. Its Runtime group is
  `runtime/th06/`, with entry `th06.html`; all declared code files, including
  JS/WASM and any other dependencies, must have matching lengths and SHA-256s
- A fresh profile needs a valid Release Catalog and its TH06 Package descriptor
  with the same revision. The canonical base contains exactly `game-data`,
  `shared-msgothic`, and `shared-unifont`, with the source paths above and targets
  `/th06.data`, `/msgothic.ttc`, `/unifont.otf`. Sources resolve relative to the
  descriptor URL; preserve that layout if the descriptor is not at the root
- Package DATA length/hash/layout must agree with Host. The sample rejects
  embedded Runtime descriptors and resource-type optional components. It does
  not select extra components or silently repair conflicting installed data
- Inspection only probes availability. Prepare hashes installed base objects
  and verifies a complete Runtime generation; successful HEAD requests alone
  are not integrity or gameplay evidence

The mount allows only the three metadata filenames, root `thNN.package.json`
descriptors, and `assets/`, `content/`, `runtime/`, `packages/`, `language-packs/`,
`games/`, `shared/` paths. Built UI files take precedence. Dot paths and symlinks
escaping the external root are not exposed. Arbitrary external-root files are
not served. See [preview implementation](../scripts/serve-ui.mjs),
[acquisition checks](../app/services/sample-launch.client.ts), and
[Runtime generation contract](../src/contracts/runtime-generations.mts).

## 4. Stage B acceptance checklist

Record each item as **passed**, **failed**, **blocked**, or **not run**, with the
revision, Node/OS/browser versions, artifact generation, and relevant evidence.
Never report synthetic behavior as a real Runtime result.

### Source-only UI in a permitted browser

1. Follow library → TH06 settings → Help → browser Back. Also test Escape,
   explicit Close, Forward, direct `/play/th06?panel=help`, and refresh. Preserve
   unrelated query/hash values; return focus to the correct trigger. Return to
   the library and confirm rail selection/position survives, including resize
2. Change a setting, open/close Help, and reload to check saved preference intent.
   The settings form does not configure the diagnostic game. Hidden optional
   controls without Host metadata must not erase saved intent
3. Retain exactly one `[data-runtime-host] iframe` DOM node across route and
   overlay changes. A full document reload naturally creates a new host. Help
   must be a single root-owned panel. Navigation uses public Router APIs and
   `useBlocker`; the older backup branch's private adapter is not used
4. Interrupt Help entry with Close/Back, reopen during exit, and repeat rapidly.
   Look for one continuous surface, no duplicate overlay, stale dismissal, focus
   theft, or invisible focus trap. Test reduced motion, including changing it
   while open. Synthetic motion fixtures supplement this visual check

### Original TH06, only with matching private artifacts

1. Open the TH06 validation section and choose **重新检查** (recheck). If metadata,
   bytes, or storage is unavailable, capture the exact reason and stop that
   path. Do not bypass hash checks or substitute synthetic bytes
2. Choose **准备游戏资源** (prepare). Verify progress and separate completion:
   **准备完成，尚未启动** / **TH06 资源已准备，尚未启动**. There must be no automatic
   launch. During acquisition, leaving the view does not cancel the root-owned
   job; **取消准备与下载** is the explicit cancellation action. Once a Runtime
   session exists, cross-page departure must use the close guard
3. Choose the separate **启动 TH06** action. It must target the still-prepared
   epoch. Confirm real first-frame/gameplay evidence, not merely an iframe load
   or ready response. Repeat prepare/cancel/retry and check that an obsolete
   completion cannot start another session
4. Test arrows, Z, X, and Shift with game focus. With Help, buttons, and form
   controls focused, game input must not leak. Blur/background and return while
   holding a key; verify no stuck input. Help/Back must retain the same live
   iframe without resetting gameplay, including a game started over the library
5. Use **退出游戏** and **保存并退出**; the session closes only after successful sync.
   Reprepare/restart and check an identifiable disposable save change. Also test
   page departure and Cancel/Stay. A live save failure must preserve the session
   and expose retry/stay/explicit discard. Unexpected native exit during saving
   must retain a loss warning, with no false save-success or impossible retry
6. Exercise delayed save plus a newer navigation/Help intent: the old completion
   must not navigate to an obsolete destination. Use the synthetic fixture for
   controlled save failures, detached frames, and timing races; mark equivalent
   real-Runtime cases unverified unless actually reproduced with disposable data

The diagnostic profile is fixed to **TH06 / Japanese / music-none / keyboard**.
General language, music, touch, room, and live-setting integration are not being
accepted by this flow. Do not interpret a touch checkbox as playable touch input.

### Physical device and orientation

Use a separately permitted device/browser setup; this loopback-only preview is
not automatically reachable from a phone. Record model, OS, browser/version,
portrait/landscape dimensions, and any external keyboard. In both orientations,
check library rails, settings scroll, safe areas, Help/close dialogs, focus,
Runtime toolbar reachability, and interruption/reopen motion. Rotate while Help
or a save confirmation is open and verify no lost controls or duplicated host.
Assess actual responsiveness on the device. A desktop mobile viewport is only
layout evidence; no phone support/performance result can be inferred from it.

This checklist does not accept full game migration, multiplayer/Adonis,
offline/PWA publication, production deployment, or legacy-entry retirement.
