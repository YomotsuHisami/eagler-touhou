# React frontend publication

The source producers publish the sealed React Router artifact by
default. Host, self-host, import and external assembly use the same portable
candidate writer, with no legacy rendered-site prerequisite. This source change
is not a live deployment or production cutover approval. Build commands do not
register a worker, upload game resources, or change browser saves.

## Default producer ownership

`build:ui` finalizes `ui-artifact.json`: the exact input inventory, mount, hashes,
and prebundled navigation-worker prelude. `lib/ui-build.mjs` refreshes this
artifact from source when needed. `lib/frontend-manifest.mjs` selects its actual
Framework files and the retained standalone informational/recovery assets.
`package-server.mjs` assembles Runtime/Package data and then calls
`lib/ui-frontend.mjs` to install that UI into the same candidate tree, emit the
registration marker and bounded nginx routes, and build the single worker.

Self-host bundles carry a verified `ui-prebuilt/` input. They require neither
React/Vite/TypeScript/esbuild nor a legacy renderer: their npm runtime dependencies
remain acorn, fflate and workbox-build. Canonical TypeScript contracts and services
are still source-owned; the core build no longer runs the legacy HTML optimizer.
The three loose legacy-reader entries retain their complete browser-module
closure, network-addressable and outside shell precache.

Obsolete authored app/lobby entrypoints, DOM controllers and the legacy HTML
optimizer have been removed. Current presentation and navigation are owned by
`app/`; canonical `src/contracts`, focused `src/launcher` helpers and Package/data
compatibility readers remain. Mixed core modules retain only their used contracts,
data/parsers and pure models; obsolete notice DOM controllers, locale singleton
translation and history mutation exports are removed. `public/styles.css` is limited to the shared standalone information
pages' base styles, fonts, grain, scrollbars and blockquotes. Current Launcher CSS
is built from `app/styles.css` and colocated React/Runtime styles.

`en.html` and `lobby.html` remain generated aliases of the Framework `index.html`,
not authored legacy pages. Previously published legacy releases retain their own
verification and rollback paths. Removing obsolete source does not delete or
rewrite those retained release artifacts, and is not browser/cutover acceptance.

`refresh-deployment-app-shell.mjs --frontend` prepares and verifies a sibling
candidate before replacing an offline directory. It retains the previous
artifact at the printed `previous` path for rollback. This can require space for
a second copy of the deployment. Refresh without `--frontend` preserves the exact
UI files/prelude and refreshes only the shell/Runtime-pointer contract; it does
not silently switch to whichever UI source build is newest. Live symlink targets
are not accepted by the refresher.

## Optional composition from an existing deployment

Start from a verified hosted, external, or import deployment with a release
manifest and immutable Runtime Manifest. Keep that directory for rollback.

```sh
npm run build:ui
node scripts/assemble-ui-publication.mjs \
  --source=/absolute/path/to/verified-site \
  --ui=.cache/build/ui-main/client \
  --output=/absolute/path/to/new-ui-site
```

The output must not exist and its parent must already exist. The assembler never
replaces or nests itself inside either input. It rejects symlinks, unexpected
files, source inventory/hash mismatches, changed Runtime generations, UI asset
collisions, and missing shell assets. An empty build-owned `.tmp` is tolerated;
interrupted nonempty staging is rejected.

Assembly copies the base deployment to a sibling candidate and overlays the
Framework shell. `index.html`, `en.html`, and `lobby.html` contain the same React
entry; the existing legacy-entry adapter preserves URL intents and English
identity. When the input is an older legacy deployment, its remaining frontend
files are preserved in this optional overlay for bounded compatibility and rollback, but
are not in the new shell precache. New source-produced candidates do not recreate
those removed app/lobby bundles. Generated Framework assets are enumerated from the actual output tree, including its late-generated
`assets/manifest-*.js` that is absent from the Vite ownership snapshot.

`ui-publication.json` records the base release, compiled UI input identities,
mount and navigation contract, canonical host artwork identities and supported
origin-migration policy. This marker is integrity-precached so offline reload can
validate the same registration gate. The shell identity lives in deployment.json.
The existing deployment,
release manifest, and checksums are regenerated and verified. Every base byte
outside the explicit UI overlay is compared unchanged. Runtime trees, pointers,
Package descriptors/catalogs, resource payloads, and host artwork stay owned by
the original publication. This is byte-preservation evidence, not browser save
migration or end-user gameplay evidence.

## One worker and offline behavior

`buildAppShell` now accepts explicit optional `appShellFiles` and
`workerPrelude` inputs. The Framework artifact seals the navigation contract;
the default candidate writer uses the sealed Framework inventory and prelude. The same `app-shell-sw.js` embeds the existing Runtime cache and protocol;
no second registration, storage namespace, or Runtime owner is introduced.

The optional navigation resolver runs after Runtime handling and exact precache
files. Only declared HTML navigations use the cached `index.html`. Unknown
routes, missing JS/WASM/DATA, descriptors, `/games/`, and `/shared/` are never
converted to HTML. Shell installation fetches/verifies the entire React shell
and its lazy chunks, never game Runtime or Package resources. It preserves the
existing activation and rollback behavior: no install-time `skipWaiting`, no
activation-time claim/prune, failed candidates are removed, and the former shell
remains usable. Existing Runtime/Package cache names are unchanged. The assembler
does not migrate IndexedDB, saves, replays, or local preferences.

The React `AppShellProvider` registers only after validating this marker against
the actual same-origin document mount. It delegates registration, updates,
activation and reload to the existing `src/launcher/app-shell-client.mts` owner.
Runtime sessions, explicit resources/import/file operations, launch/replay
preparation, rooms, unsaved drafts and decisions defer activation/reload;
StrictMode and page lifecycle cleanup fence stale callbacks. Ordinary unassembled
preview has no marker and registers nothing. Healthy readiness is visually silent;
updates/errors use compact status. Offline readiness requires a positive worker
status response, not merely successful registration. Server and release validators now verify the Framework inventory, marker,
Host product membership, Runtime exclusions and generated route configuration.
Older retained releases remain verifiable through their legacy branch.

## Root and nested mounts

The Framework and Vite configs share `scripts/ui-build-config.mjs`:

```sh
EAGLER_UI_MOUNT_PATH=/launcher/ \
EAGLER_UI_BUILD_DIRECTORY=.cache/build/ui-main-nested npm run build:ui
node scripts/assemble-ui-publication.mjs \
  --source=/absolute/path/to/verified-site \
  --ui=.cache/build/ui-main-nested/client \
  --output=/absolute/path/to/new-ui-nested-site --mount=/launcher/
```

`EAGLER_UI_MOUNT_PATH` defaults to `/`. With no explicit output, root builds use
`.cache/build/ui-main`; non-root mounts use a stable mount-hashed sibling
`.cache/build/ui-main-mount-<hash>`. A mount-only environment therefore cannot
overwrite the root artifact. Named CI fixtures set both variables explicitly.
Source cache reuse requires matching source inputs, mount and sealed artifact
identity, and its writer lock belongs to the output path rather than the mount.
Use separate outputs for different mounts. The build
writes `ui-build.json` with the matching mount; nested assembly requires it.
Assembly checks the actual emitted `window.__reactRouterContext.basename`, SPA
mode, and executable/style asset references. A root-built HTML file is rejected
at a nested mount even if an independent route helper accepts nested URLs.

The output directory represents the application root. Its host must expose that
whole directory at the configured mount, including metadata, Runtime resources,
SW and hashed assets. Changing the mount does not migrate prior origin/scope
storage. Actual browser navigation, resource URL resolution, and offline nested
reload remain CI acceptance gates; passing helper or build tests alone does not
prove them.

## HTTP hosting and external resources

Every candidate contains `ui-navigation.nginx.conf`, generated from the same
Framework route contract. The optional CLI also prints it; neither installs it. Put it
before broader regex locations in the intended server block, with a document
root that maps the configured URI mount to this artifact. Preserve current
Runtime immutable handling, byte ranges, MIME types, metadata revalidation, old
mount retirement, and missing-file 404 behavior. Never add an unconditional
`try_files ... /index.html` catch-all. Legacy `.html` aliases exist as real files.

For external mode, the assembler requires `/games/` and `/shared/` bytes to be
absent. Their existing hosting policy must continue to issue 307 redirects to
the approved resource origin, preserving path and query. The UI nginx fragment
has no matching resource-prefix location and the worker leaves those requests
to the network. External origins are hosting configuration, not guessed or
rewritten by UI assembly.

## Evidence and remaining gates

```sh
node --test tests/test-ui-publication.mjs
EAGLER_UI_FRAMEWORK_ARTIFACT=.cache/build/ui-main/client \
  node --test tests/test-ui-publication.mjs
EAGLER_UI_FRAMEWORK_ARTIFACT=.cache/build/ui-main-nested/client \
EAGLER_UI_BUILD_DIRECTORY=.cache/build/ui-main-nested \
EAGLER_UI_MOUNT_PATH=/launcher/ node --test tests/test-ui-publication.mjs
node tests/test-app-shell-worker-update-status.mjs
node tests/test-app-shell-contract.mjs
```

The tests use synthetic bytes, execute the generated worker in a Node VM, and
exercise HTTP navigation/404/ranges. The optional real-artifact case verifies
actual Framework output instead of a synthetic HTML shape. These checks do not
run a browser or register a worker on a production origin. Browser SW lifecycle,
real Package/save persistence through cutover/rollback, physical-device checks,
and remaining feature parity are still required before live production cutover.
The source-producer default has changed; that alone does not establish these
acceptance results.

## Synthetic browser lifecycle lane (CI only)

After both real root and `/nested-launcher/` builds, run:

```sh
node tests/publication/build-fixtures.mjs
npx playwright test -c playwright.publication.config.ts
```

The dedicated config serves unassembled preview and separate root/nested
synthetic A/B artifacts on loopback-only fixture origins. It covers first
installation, offline deep reload, update deferral while a real Help dialog is
open, safe activation/reload after dismissal, missing-asset 404, and preservation
of synthetic CacheStorage/IndexedDB/localStorage sentinels. These are not
original-game saves or a gameplay/migration acceptance claim. Browser execution
was not attempted in the restricted local environment; CI is the browser gate.
