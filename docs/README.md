# Documentation

This directory contains the public engineering and operator documentation for
Eagler Touhou. The repository root `README.md` is the product overview; the
documents here describe stable product boundaries, architecture, development,
deployment, and verification.

## Start here

- [Product surface](PRODUCT_SURFACE.md) - supported games, Launcher features,
  multiplayer behavior, deployment modes, and deliberate limitations.
- [Architecture](ARCHITECTURE.md) - module ownership, browser/runtime boundary,
  persistence, offline behavior, multiplayer, Host, and release architecture.
- [Development](DEVELOPMENT.md) - maintainer workspace, dependencies, Runtime
  builds, and the normal validation commands.

## Hosting and deployment

- [Self-hosting](SELF_HOSTING.md) - shortest supported path for an operator
  with a Runtime Release and legally-owned installations for the selected
  Product Catalog games.
- [Self-hosting reference](SELF_HOSTING_REFERENCE.md) - self-host inputs, generated static
  site, resource modes, WebSocket relay/TURN configuration, and updates.
- [External resource mode](EXTERNAL_RESOURCE_MODE.md) - paired Hosted resource
  origin and External user-site generation, routing, rollout, and verification.
- [Release engineering](RELEASE.md) - maintainer release candidates,
  HTTP-to-HTTPS migration/HSTS contracts and public behavior verification.

These documents intentionally serve different audiences. Do not duplicate
their content just to make each document standalone: link to the owning
document instead.

## Reference

- [Artifacts](ARTIFACTS.md) - generated artifact and validation directory
  conventions.
- [Game adapter contract](GAME_ADAPTER_CONTRACT.md) - Runtime/game adapter
  ownership and declaration boundary.
- [Adapter capability classification](ADAPTER_CAPABILITIES.md) - authoritative
  required vs optional vs format-specific vs legacy-compatibility distinction.
- [Adapter behavior invariants](ADAPTER_BEHAVIOR_INVARIANTS.md) - product-level
  interaction and presentation semantics that must remain stable across
  technically different adapter implementations.
- [Adapting a game](ADAPTING_A_GAME.md) - end-to-end implementation guide,
  Runtime protocol lifecycle, verification checklist, and handoff template for
  adding another title.
- [Engineering playbooks](playbooks/README.md) - implementation ownership,
  recurring pitfalls, superseded approaches, and verification methods for
  adaptation and maintenance work.
- [Runtime storage testing](RUNTIME_STORAGE_TESTING.md) - storage contract and
  browser conformance lanes.
- [Mobile function key](TOUCH_FUNCTION_KEY.md) - ordinary C input ownership,
  supported titles, layout compatibility and verification.
- [Automatic dialogue compilation](THCRAP_AUTO_DIALOGUE.md) - TH10/TH11
  parameterless MSG instructions, package regeneration and regression gates.

## Repository map

| Path | Owner / purpose |
| --- | --- |
| `public/` | Source-controlled Web surface: HTML, CSS, manifest, static fonts/assets, vendored browser files, and tiny browser entry facades. |
| `src/launcher/` | Authoritative Launcher TypeScript implementation. |
| `src/contracts/` | Typed browser-visible metadata and protocol contracts. |
| `src/browser-facades/` | Tracked compatibility/publication facades for browser-facing contract URLs; they re-export the typed contract owners and are not TypeScript-generated source. |
| `src/app-shell-sw.js` | Service Worker source. Generated App Shell output does not live here. |
| [`package/`](../package/README.md) | Browser Package Store, package generation/install/ZIP subsystem. This is product code, not npm metadata. |
| `legacy/` | Deliberately bounded read/migration compatibility for previously published data formats. New writes do not target legacy formats. |
| [`lib/`](../lib/README.md) | Reusable Node-side build, release, verification, and contract adapters. Reusable code belongs here rather than in CLI scripts. |
| `server/` | Standalone relay/TURN-side server code and server configuration helpers. |
| `integrations/` | External integration adapters such as thprac. |
| `host/` | Portable Node self-host entrypoints, pinned content-preparation inputs, Python requirements, and self-host bundle template. |
| [`scripts/`](../scripts/README.md) | Portable product build, packaging, verification, and CI entrypoints. |
| [`tools/maintainer/`](../tools/maintainer/README.md) | Project-maintainer-only Runtime/release/bundle adapters and live infrastructure probes; not a self-host API. |
| `tests/` | Repository and workspace tests. New dedicated Browser entrypoints/runners belong under `tests/browser/`; established explicit Browser lanes may remain at the test root until a coherent layout migration. Shared fixtures/helpers live under `tests/support/`. |
| [`examples/deployment/`](../examples/deployment/README.md) | Non-authoritative Web-server examples for serving an already generated site. |
| `config/` | Canonical workspace and build-policy registries. |

The root `host-manifest.mjs`, `product-catalog.mjs`, `release-catalog.mjs`,
`resource-mode.mjs`, and `runtime-protocol.mjs` files are intentionally tiny
stable Node/contract facades. They re-export the owning modules from
`lib/contracts/`; they are not parallel implementations.

## Generated and local state

Generated or machine-local content must not become a second source tree:

- `.cache/build/browser/` - compiled Launcher/browser modules;
- `.cache/` - other reproducible build caches;
- `node_modules/` - local Node dependency state;
- `dist/` - generated Host/Import output;
- `artifacts/` - release candidates, validation evidence, and temporary
  operational outputs.

Do not edit generated output to change product behavior. Change the owning
source/configuration and regenerate it.

## Governance

Contribution workflow and engineering expectations are documented in
[`CONTRIBUTING.md`](../CONTRIBUTING.md).
