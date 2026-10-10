# Deployment, Network and Collaboration Playbook

Status: active

## Purpose

Deliver Eagler static sites, packages, Relay/TURN services and collaboration handoffs with explicit cold-start, migration, rollback and evidence boundaries. Keep temporary server facts and secrets out of durable guidance.

## Applicability and authority

Normative release and artifact ownership lives in [Release engineering](../RELEASE.md).
Existing release scripts remain the implementation until their consumers are
migrated together.

- Cold-start installation and shareable Host packaging are distinct from a
  production cutover.
- A local or isolated server PASS is not a production cutover; a Relay/TURN contract PASS is not a browser or human multiplayer PASS.
- Public deployment changes require explicit user authorization and a precise target scope.

<!-- knowledge-id: K-DEPLOY-001 -->
<!-- knowledge-id: K-DEPLOY-002 -->
<!-- knowledge-id: K-DEPLOY-003 -->
## Normal design

Build and publish from one verified Release generation. The project produces a
flat static site and optional resource/service artifacts; it does not prescribe
Nginx, Caddy, Apache, IIS, systemd, containers or a server operating system.
Operators own the concrete atomic directory/object/container/CDN cutover and
rollback mechanism. Validate the complete static manifest, generated HTML,
managed DATA hook, JS/WASM MIME, Package generation and Runtime mode together.

For HTTP-to-HTTPS migration, ordinary HTTP can redirect only after the old-Origin migration path is available. Keep exact `migrate.html` reachable without HSTS, show the user the migration action, and transfer only allowed application data with nonce/origin-checked `postMessage`. Do not claim that a normal 301 preserves HTTP-Origin IndexedDB.

For network play, use WebRTC full mesh with WebSocket fallback, short-lived TURN credentials from a server-side shared secret and targeted relay envelopes. Record candidate type, route state and actual signaling/relay evidence. External WSS may be reverse-proxied through a same-origin path; do not place secrets or temporary IP-specific values in product logic.

### Nginx static routing and response metadata

Do not use an unconditional `try_files $uri $uri/ /index.html` fallback for this launcher. It turns `robots.txt`, misspelled assets and arbitrary unknown paths into `200 text/html` soft 404 responses. That hides publication mistakes, breaks crawler directives and can make monitoring report a healthy page for a missing resource. Serve the launcher document only at its declared entry routes; let unknown paths return a real `404`.

Treat crawler and application metadata as first-class release files. `robots.txt` must resolve to the authored file with `text/plain`; `site.webmanifest` must use `application/manifest+json`. Distribution defaults do not consistently include `.webmanifest`, so verify the public `Content-Type` rather than assuming the local server and Nginx MIME tables agree. Keep canonical-origin metadata deployment-owned when the same artifact is self-hostable; do not hard-code one public origin into the generic package.

Nginx location selection can bypass otherwise correct rules. Check exact-match and prefix locations for manifests, Relay paths, external game resources and migration pages before adding a fallback. A new nested `location` with its own `add_header` directives stops inheriting parent `add_header` values; repeat required CORS, HSTS and cache headers in every header-owning location, or include one shared snippet. Verify headers on nested Runtime/resource URLs, not only on `/`.

Preserve protocol-specific proxy behavior. A static-site routing cleanup must not absorb the WebSocket endpoint or external resource prefixes. The WSS location still needs HTTP/1.1 upgrade forwarding, and large external resources still need their intended Range, CORS and cache behavior. Run `nginx -t` before reload, retain the previous site file, then test through the public origin after reload; syntax success alone is not traffic proof.

### Anonymous transport statistics

`shared.netplayTelemetry` optionally enables same-origin selected-ICE-pair
statistics in the Launcher. `src/launcher/netplay-telemetry.mts` samples every
15 seconds. `server/netplay-telemetry.mjs` is a separate loopback HTTP service,
configured with `EAGLER_NETPLAY_TELEMETRY_PORT`, `EAGLER_NETPLAY_TELEMETRY_ORIGIN`
and `EAGLER_NETPLAY_TELEMETRY_STATE`. Proxy `/netplay-stats/` to that service.
The GET page and `/summary` expose aggregates; POST `/sample` admits bounded
same-origin samples. Disable access logging for this location. No IP, name or
persistent identifier is retained in statistics. Runtime-scoped random IDs are
used only in memory for duplicate suppression. Persist daily aggregates for
7 UTC calendar days. Keep spectator/WebSocket traffic separate from TURN and
webdriver automation outside the human sample.

Ratios are time-weighted samples from reporting clients, not a census of all
users. Count mixed three-player meshes by their individual selected links.
Discard counter resets, changed candidates and background suspension instead
of attributing old bytes or extrapolating missing time. Capacity estimates must
include direct users in the total population and label the TURN share, room
size, protocol overhead and headroom assumptions. Browser payload counters are
not a measurement of billed TURN egress. Existing `mode=rtc` logs cannot recover
historical direct/TURN proportions.

### Relay/TURN deployment and incident verification

Treat WebSocket Relay and TURN as separate transport layers. WSS owns room control and WebRTC signaling; coturn relays WebRTC traffic when direct ICE cannot connect. A persistent WSS connection does not prove game traffic uses WSS, while a final diagnostic route of `relay` means WebRTC did not become ready and gameplay fell back to the WebSocket data path.

Do not accept `systemctl active`, an open `3478` socket or a single TURN echo probe as proof that the deployed service uses its intended configuration. Before restart, verify the configuration file is readable by the exact systemd `User` and `Group`; after restart, inspect effective realm, listener, relay and public/private `external-ip` mapping. A configuration file owned by an unreadable group can leave coturn active on defaults while all service-level health checks appear green.

Keep peer filtering explicit. If coturn reports `A peer IP ... denied`, identify the exact `allowed-peer-ip` or `denied-peer-ip` rule and the address produced by NAT/external mapping before changing policy. Do not remove private-range or multicast protections merely to make a probe pass. Validate the narrow mapping and listener/relay addresses that the host actually owns.

TURN verification has four distinct evidence levels:

1. credential contract: Relay returns TURN URLs plus short-lived username and credential without exposing the shared secret;
2. allocation contract: a forced `iceTransportPolicy=relay` browser obtains a selected `relay/relay` ICE pair;
3. application transport: two independent clients execute the real `peers → offer/answer → candidate → rtc-ready` protocol, the server chooses `route.mode=rtc`, and control/input data crosses the selected relay pair;
4. human/device acceptance: the named real devices complete a room and gameplay path.

For level 3, correlate Relay and coturn evidence: both clients must report selected local and remote candidate type `relay`, Relay must record `route.mode=rtc`, and coturn must record successful allocation, permission/channel binding and non-zero traffic. A standalone quality probe does not prove the shipped Runtime received or applied the same `iceServers` configuration.

Keep the RTC arbitration window long enough for mobile TURN allocation and DataChannel setup. Measure real-device timing and use a bounded timeout; when a room falls back, record whether `rtc-ready`, `rtc-failed`, SDP/candidates and DataChannel open were observed on each player. Increasing the timeout cannot repair an unreadable coturn configuration or a lost signaling event.

Collaboration handoffs should name source revision, local/public endpoint distinction, available package/data limits and what was actually tested. A local debug package is not a public deployment.

## Invariants and pitfalls

- Test an empty/isolated host before a hard-to-update deployment. Trial is not production.
- Do not upload, publish, cut over or clean remote data unless the user explicitly authorizes that exact scope.
- Never store tokens, passwords, private keys or non-ephemeral TURN secrets in the repository or a shareable ZIP.
- Nginx root 308/nested 200/app.js 200/WASM MIME/WebSocket upgrade and migration routes are separate gates.
- A `200` response is not sufficient for static metadata: verify body identity and MIME for `robots.txt`, `site.webmanifest`, manifests, modules and WASM.
- Unknown paths must return `404`; never accept an SPA fallback as evidence that a requested release file exists.
- Recheck inherited CORS, HSTS and cache headers whenever a nested Nginx `location` adds any `add_header`.
- Verify existing public services and package versions before attributing a failure to a trial package.
- CDN, relay, origin, local host and offline package ownership must be stated separately.
- A successful TURN allocation is not an application-route PASS; require `route.mode=rtc` and selected `relay/relay` candidates when claiming TURN carried gameplay data.
- Verify service-account readability and effective coturn configuration after every ownership, package or systemd change.

## Superseded approaches

Ad hoc production edits, infrastructure-specific assumptions in portable
artifacts, secrets in shareable packages and an unconditional redirect before
migration are superseded by verified static generation plus an operator-owned
atomic rollout.

## Code and system anchors

- `docs/RELEASE.md`, `docs/SELF_HOSTING.md` and
  `docs/EXTERNAL_RESOURCE_MODE.md`: release/operator ownership.
- `scripts/package-server.mjs`, `scripts/verify-server-build.mjs`,
  `scripts/verify-deployed-site.mjs` and
  `scripts/verify-origin-cutover.mjs`: static publication/deployment
  contracts.
- `tools/maintainer/verify-public-first-install.mjs`,
  `tools/maintainer/verify-public-relay-fallback.mjs`,
  `tools/maintainer/verify-public-targeted-relay.mjs` and
  `tools/maintainer/verify-public-turn-quality.py`: explicit live/public
  probes.

## Verification

1. Build/check the release and scan package text for trial paths, credentials and private endpoints.
2. Validate the operator's chosen server/infrastructure configuration, then
   verify the public launcher entry, `robots.txt` body/MIME, Web App Manifest
   MIME, a randomized unknown-path `404`, module/WASM MIME, nested
   security/CORS headers, migration routes and WebSocket upgrade.
3. Test a fresh-browser first install and the operator's atomic
   activation/rollback procedure on staging before production.
4. Separately verify public origin/CDN, Relay, TURN candidate type and package generation if a production claim is in scope. For TURN, progress from credential and allocation checks to a two-client real-protocol route test; require `route.mode=rtc`, `relay/relay` selected candidates and coturn traffic evidence.
5. Record the exact target, changed files, rollback point and evidence tier in the handoff.

## Deliberately omitted claims

This playbook does not contain credentials, permanent server addresses or a production deployment authorization. It does not claim that a trial host, static package or transport contract proves public human/device acceptance.
