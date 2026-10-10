# React launcher maintainer lane

The default frontend remains `main`. Select `react` explicitly when serving or packaging the built rewrite. Both frontends use the same runtime protocols, package storage and multiplayer services.

## Development and verification

Use Node.js 24 with dependencies installed using `npm ci --ignore-scripts`. Run:

```sh
npm run typecheck:ui-rewrite
npm run typecheck:ui-rewrite:tools
npm run test:ui-rewrite
npm run build:ui-rewrite
EAGLER_FRONTEND=react npm start
```

On PowerShell, set `$env:EAGLER_FRONTEND='react'` before `npm start`. For a launcher checkout below `worktrees`, also set `EAGLER_WORKSPACE_ROOT` to the actual workspace root. Development serving uses a root-mounted artifact.

`EAGLER_REACT_BUILD_DIRECTORY` selects the build output directory, defaulting to `.cache/build/ui-rewrite`. `EAGLER_REACT_MOUNT_PATH` selects the build-time mount, defaulting to `/`. Build and host selection must use the same mount. A nested artifact belongs on a matching mounted static host. An existing built artifact is consumed without invoking the compiler during host assembly.

Offline support is an explicit deployment choice. Set both `EAGLER_REACT_APP_SHELL=isolated` and `EAGLER_REACT_APP_SHELL_ORIGIN` to the exact intended origin before building. Setting only a mount does not enable a worker. The built metadata binds the worker to that origin and mount, and rejects foreign or ancestor registrations. Rebuild to change this identity. `refresh:deployment-frontend` requires explicit React selection and a matching artifact.

## Components and return policy

`LibraryCards` renders the same card artwork, titles, selection motion and responsive dimensions in the launcher and directory. The directory adds its room list and selects a product filter before activating options. Page-specific card markup, sizing, typography and selection colors are not separate variants.

`useLibraryOptionsPresence` owns options entrance and exit in both contexts. The directory's native dialog provides focus and input isolation, follows the shared visual lifetime, and has no separate animation, image-decode wait or close timer. Both contexts use the same desktop entrance and the same full-height mobile slide with a 240 ms close lifetime.

`SettingsBody` and `OptionsPanel` are shared. Multiplayer adds room controls and visibility settings to the established single-player settings layout. Multiplayer restrictions leave the corresponding control visible and disabled with a reason. Common row spacing, scrolling and responsive header dimensions follow the single-player baseline. Room drawers move the existing header and settings carrier rather than cloning their state.

`page-history.ts` declares fixed page parents: launcher is the root, lobby returns to launcher, single-player options return to launcher, and multiplayer options and rooms return to lobby. Direct invitations seed those same browser history parents. Page buttons and browser Back use the same navigation owner and save/leave cleanup. History records retain bounded ancestor positions, not a separate route stack or inferred entry source.

`InformationalDialog` owns the native modal shell and `useMainDialog` lifecycle for Apple refresh help, donations and multiplayer rules. Callers supply body content and one explicit layout: standard, artwork-width or scrollable. All three use the same completion-driven Web Animations adapter, including interruption and reduced-motion handling. Native animation completion closes the dialog; there is no mirrored CSS duration, fallback close timer or separate presence owner. Unsupported/partial animation APIs degrade to immediate presentation and closure. Donation's immediate-close mode and unavailable-artwork action use that same lifecycle. The shared motion replaces the older per-dialog timings with one whole-dialog fade/translate; backdrop colors remain static until native close. This intentional visual change still needs browser review. Other numeric `useMainDialog` callers retain their established timing. The colocated stylesheet is React's sole shell styling owner; old Apple/guide selectors in `public/styles.css` remain unchanged for canonical main, and no React shell matches them.

Attached dialogs and the touch editor return to their opener. Gameplay has one Back layer over its options or room. Save failure retains the existing Retry/Leave/Stay decision. A completed multiplayer game exposes the same room before a later Back releases membership. TH09's native title room remains an attached overlay of its retained runtime.

Synthetic mounted tests cover routing, native message boundaries and ownership. They do not establish actual game, mobile-device or durable browser-storage acceptance. Real browser and native runtime gates remain required before replacing the production frontend.
