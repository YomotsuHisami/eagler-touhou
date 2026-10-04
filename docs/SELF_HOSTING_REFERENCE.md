# Self-hosting reference

This document owns the operator-facing behavior contract for a generated
Eagler Touhou site. It intentionally does not prescribe an operating system,
Web server, TLS implementation, CDN, process manager, firewall, container
runtime or rollback mechanism.

For the shortest workflow, start with [Self-hosting](SELF_HOSTING.md).

## Persistent inputs and generated output

Persistent operator inputs:

```text
eagler-touhou.config.json
games/th06/
games/th07/
games/th08/
games/th10/
```

Project/release input:

```text
runtime-release/
```

Reusable local state:

```text
.cache/python/
.cache/tools/thtk/
.cache/generated/
```

Disposable generated output:

```text
dist/site/
dist/external-site/
dist/import-site/
dist/import/
```

`dist/external-site/` is present only after the operator derives External mode
from `dist/site/`. It is disposable generated output, like the other `dist/`
directories.

Do not edit generated site files. Change the persistent configuration or input
resources and regenerate.

## Host configuration

`eagler-touhou.config.json` uses the `eagler-touhou/host-config/1` schema:

```json
{
  "schema": "eagler-touhou/host-config/1",
  "netplay": {
    "relay": "wss://relay.example.com/eagler-netplay/"
  },
  "externalImportSource": {
    "url": "https://downloads.example.com/touhou-packages",
    "hint": "Optional instructions or access code"
  }
}
```

Both values are optional.

- Without `netplay.relay`, single-player remains valid and multiplayer has no
  configured WebSocket fallback.
- `netplay.relay` must be a `ws://` or `wss://` URL.
- `externalImportSource.url` must be HTTPS when configured. It only gives the
  Launcher an operator-provided external link; the Launcher does not silently
  download third-party game packages.
- TURN credentials do not belong in this file. TURN/STUN information is owned
  by the signaling/relay service and may be supplied dynamically.

Run `npm run host:doctor` to validate the local Host inputs and show optional
service warnings.

## Hosted, External, and Import modes

The generated site has three canonical game-content delivery modes.

### `hosted`

`npm run host:build` produces `dist/site/`. The site may publish deployer-
generated game DATA, Package metadata and selected optional components such as
OGG/language resources together with the Launcher and App-managed Runtime.

### `import`

`npm run import` first prepares a verified hosted generation from the current
inputs, reusing valid expensive `.cache/generated/` intermediates where the
underlying producers permit it. It then derives:

```text
dist/import-site/
dist/import/th06.zip
dist/import/th07.zip
dist/import/th08.zip
```

The Import site publishes the Launcher and App-managed Runtime but not the
hosted original game payload. The ZIPs use the same canonical Package
Descriptor format as hosted installation.

If `dist/site/` is already a verified hosted generation for the current game,
Runtime Release, configuration and music inputs, Import reuses it instead of
rebuilding the hosted base. Maintainers can force that base to be rebuilt with
`npm run import -- --rebuild-hosted-base`.

`import-only` and `import-partial` are historical read-compatibility values,
not new production modes.

### `external`

`npm run package:external-site -- --source=dist/site --output=dist/external-site --runtime-release=runtime-release --profile=web-release-external` derives an External site from a verified Hosted site. It keeps the Launcher and each selected game's Runtime HTML, JavaScript, and WebAssembly in the generated site, together with the Release Catalog and Package Descriptors. It omits `games/` and `shared/` payload files. The serving infrastructure must redirect those same-origin payload routes to an external HTTPS origin. See [`EXTERNAL_RESOURCE_MODE.md`](EXTERNAL_RESOURCE_MODE.md) for routing and verification requirements.

The Hosted source remains the complete resource-origin artifact and must be
deployed together with its derived External site. The External guide owns the
operator procedure; this reference only defines the generated-artifact
boundary.

## Static Web-server behavior

The generated site can be served by nginx, Caddy, Apache, IIS, an object store,
a CDN, a container, a NAS, or another HTTP server. The implementation is the
operator's choice; the observable behavior is the contract.

At minimum:

- public use should be HTTPS or another browser-defined secure context;
- `.wasm` must use `application/wasm`;
- JavaScript/ES modules must use a JavaScript MIME type;
- HTML, JSON and other unversioned entry resources must be able to revalidate;
- content-versioned immutable resources may receive long cache lifetimes;
- query parameters used for content identity must remain part of the cache key;
- the server must not add headers that break the required iframe, WASM, audio
  or Service Worker behavior;
- the generated directory must be published as one coherent revision rather
  than mixing files from different builds.

`examples/deployment/` contains non-authoritative examples. They demonstrate
expected HTTP behavior and are not installers or infrastructure APIs.

After deployment, verify the actual public URL rather than assuming the server
configuration is correct:

```text
npm run verify:deployed -- https://example.com/
```

## App Shell and offline behavior

`dist/site/app-shell-sw.js` is deployment-specific generated output. The Host
build includes the Launcher module closure and App-owned Runtime bootstrap
files required for the selected deployment.

If only the Launcher/App Shell changes and the rest of a generated site remains
the intended deployment, maintainers may refresh its frontend/App Shell and
then verify the result using the corresponding repository commands. Generated
game DATA, OGG and language resources must not be edited in place.

## WebSocket Relay

The static self-host bundle deliberately does **not** contain the project's
Relay server implementation. Static hosting and multiplayer signaling are
separate deployment concerns.

The repository owns the reference Relay implementation at:

```text
server/netplay-relay.mjs
```

A source checkout can run it with:

```text
npm run relay
```

An operator may instead run an independently deployed compatible Relay and set
its `ws://` / `wss://` URL in `eagler-touhou.config.json`. A reverse proxy such
as `/eagler-netplay/` is only one possible topology; it is not required by the
static site format.

### Relay abuse limits

The reference relay enforces source-IP limits before room allocation. Random
`member`/`lobby` IDs, forged Origin headers, and switching to signaling or binary
relay sockets do not reset these limits. The defaults are:

| Environment variable | Default | Purpose |
| --- | --- | --- |
| `EAGLER_NETPLAY_MAX_ROOMS_PER_IP` | 2 | Simultaneously retained rooms created by one IP |
| `EAGLER_NETPLAY_CONNECTIONS_PER_MINUTE` | 60 | WebSocket upgrades admitted by the guard per IP per rolling minute |
| `EAGLER_NETPLAY_MAX_CONNECTIONS_PER_IP` | 32 | Concurrent WebSockets per IP, across all roles |
| `EAGLER_NETPLAY_MAX_ROOMS` | 512 | Total retained rooms |
| `EAGLER_NETPLAY_MAX_CONNECTIONS` | 2048 | Total concurrent WebSockets |
| `EAGLER_NETPLAY_MAX_TRACKED_ADDRESSES` | 10000 | Bound on address accounting memory |

Values must be positive integers. There is no room creation count or time-window
limit. Deleting a room immediately releases its concurrent-room quota, allowing
another room to be created. Disconnected rooms still within the existing
reconnection grace period retain their quota until deleted; reconnecting to the
same room does not consume another slot. Joining an existing room does not
consume a new-room quota. Shared networks/NAT share an IP quota; operators
can adjust these values to their expected usage.

The rolling window counts upgrades admitted by the guard, including upgrades
that subsequently fail. Requests rejected because a connection or rate quota
is already full do not extend the window. Closing a socket releases its
concurrent-connection slot; it does not remove its rolling-window entry.
An upgrade rejected by the guard receives HTTP 429. Room-allocation rejection
closes the WebSocket with code 4008; the lobby also receives a `rate-limited`
error. Idle address records are swept every minute once their connection,
room and rolling-window counts are all empty. At the address-record cap, new
addresses are rejected until records can be reclaimed.

The implementation owner is `server/relay-abuse-guard.mjs`; integration with
every socket role and room deletion belongs to `server/netplay-relay.mjs`.
`tests/test-relay-abuse-guard.mjs` runs in the default repository gate and
verifies proxy trust, rolling windows, quota release and cross-role enforcement.

For a reverse proxy, configure `EAGLER_NETPLAY_TRUSTED_PROXIES` as a comma-separated
list of the proxy's **exact peer IP addresses**, for example `127.0.0.1,::1` for a
local proxy. Set/overwrite `X-Real-IP` with the actual client address at that
trusted proxy (for Nginx: `proxy_set_header X-Real-IP $remote_addr;`). A trusted
proxy connection without a valid single-IP header is rejected. Headers from
other peers are ignored; `X-Forwarded-For` is not used. Bind the relay to the
proxy-facing interface and restrict direct external access to its port.

Restart the relay service after deploying the server changes and environment
configuration. Publishing the static launcher alone does not apply this patch.
Limits are local to one relay process and reset on restart. Multiple replicas
need shared accounting or equivalent limits at a common edge. These quotas
bound anonymous automation; they do not authenticate humans or prevent an
attacker with multiple source IPs from filling public seats. Private rooms are
hidden from the directory, not password-protected.

## TURN / STUN

TURN is server-managed and optional. WebRTC direct/STUN is attempted according
to the multiplayer service configuration, and the configured WebSocket Relay
remains a fallback path where supported.

The repository contains coturn-related helpers for maintainers/operators who
choose that implementation, but the self-host tooling does not install coturn,
open ports, create service users, modify firewalls or write system
configuration. Those actions are infrastructure-specific.

## HTTP to HTTPS origin migration

HTTP and HTTPS are different browser origins. During a migration window, old
HTTP-origin data can be transferred only while the exact old-origin migration
document remains reachable.

The Launcher advertises migration only when the generated Host Manifest
contains:

```json
{
  "originMigration": { "mode": "http-to-https" }
}
```

During that window:

- do not enable HSTS yet;
- ordinary HTTP navigation should redirect cleanly to HTTPS;
- the exact HTTP `/migrate.html` document must remain reachable without an
  earlier permanent redirect or HSTS upgrade;
- migration is an explicit user action, not something inferred from a normal
  HTTP visit.

Validate the two origins with:

```text
npm run verify:migration-cutover -- http://example.com/ https://example.com/
```

After the migration window:

1. remove `originMigration` from the Host configuration used to generate the
   site;
2. regenerate and publish the site;
3. enable the final HTTPS/HSTS policy in the operator's own edge/Web-server
   configuration;
4. validate the real public behavior.

The project's final HSTS verifier expects at least a one-year policy and no
remaining migration capability:

```text
npm run verify:hsts-cutover -- http://example.com/ https://example.com/
```

The project does not prescribe how nginx, Caddy, a CDN or another edge product
expresses those rules. `includeSubDomains` and preload are separate operator
commitments and are not enabled by the project automatically.

## Updating and rollback

Self-host updates are rebuilds:

1. update the project or unpack a newer self-host bundle;
2. preserve `games/` and `eagler-touhou.config.json`;
3. run `npm run host:build` or `npm run import`;
4. publish the newly verified generated directory as one revision.

Rollback is likewise infrastructure-owned: publish a previously verified site
revision using the operator's normal deployment mechanism. Eagler Touhou does
not impose a `current` symlink, rsync layout, container strategy, or a specific
server-side release manager.
