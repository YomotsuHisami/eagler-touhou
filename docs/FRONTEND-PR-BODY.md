## Summary

- Add a site-level Eagler Touhou directory card without adding a Product/Runtime/storage identity.
- Show the existing NOTICE.txt as inline site information; use a red multiplayer action.
- Select all-game room listings from the site entry in the local lobby; require a concrete game when creating a room.
- Apply native disclosure animation to Header global advanced settings, with reduced-motion support.
- Serve local lobby pages and their full module closure in the preview server.
- Replace legacy sprite-sheet cropping with shared independent portrait mapping for room selection and Game info (20 characters, TH08 pairs, TH09 roster).
- Add a local-only DAIRI PNG importer, explicit missing-art fallback, artist/usage documentation and publication guards. No DAIRI originals are committed or redistributed.
- Add explicit offline UI preview and source-package bootstrap helpers.

## Validation

- [x] Strict Launcher build; 56 TypeScript sources.
- [x] Related product/global preferences/lifecycle/DOM/module graph/score parsing tests.
- [x] Actual local Node HTTP route/security checks using fixture metadata.
- [x] Importer: 20 synthetic PNG fixtures, partial/ambiguous mapping, idempotency, rejected traversal/non-PNG inputs.
- [x] Offline Chromium DOM/component tests for notice, room list/create/filter, portrait pair/fallback, 1440/390px widths.
- [x] Native disclosure intermediate opening/closing heights, rapid reversal, keyboard, site/system reduced motion; real fine-pointer mode also tested via Xvfb.
- [x] Publication audit and git diff whitespace check.
- [ ] Full repository check: baseline failure `runtime build th10 multiplayer variant must match product registry`, reproduced on unmodified 6e266f0.
- [ ] Full site browser E2E: test environment blocks loopback navigation; no policy bypass attempted.
- [ ] Actual DAIRI artwork visual acceptance after local import.
- [ ] Real remote players, Relay, complete Runtime/gameplay, physical phone acceptance.

## Scope

The current dev-lobby is a local visual fixture, not real multiplayer. The runtime build configuration and game repositories are unchanged. Please review against frontend-redesign; merging the entire redesign into main is a separate decision.

## Source-package cold-start correction

- Defer loading the compiled product contract until the Launcher build has completed.
- Add isolated empty-build-cache regressions for the direct Node CLI and both npm preview modes.
- Local mode uses mock metadata only; this does not claim real multiplayer or live Runtime acceptance.

## v3 dialog / stacking correction

- Remove the redundant solo and multiplayer legacy save-upload rows from the DOM; retain the single slot library and both replay tool groups.
- Keep the complete directory (including the lobby/room iframe and transitioning cards) in a stacking context below the sibling Header. Native modal dialogs remain above both.
- Add regression tests for Header hit targets, click-through, keyboard handling, native modal precedence and save add/select/download presentation at 1440, 820 and 390px.
- Negative test on v2 CSS reproduces the Header menu being hit-tested as the score panel. The same test passes after the fix.
- Update the optional real-Runtime storage conformance runner to use the slot UI rather than deleted selectors. That live Runtime lane was not run in this environment.
