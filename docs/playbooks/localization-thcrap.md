# Localization, THCRAP and Resource Playbook

Status: active

## Purpose

Keep language packages, THCRAP host/compile/runtime preparation, fonts and game resources under explicit ownership. Separate functional text availability from original visual parity and from package/deployment mechanics.

## Applicability and authority

THCRAP integration must use a topic worktree separate from upstream tracking
and the canonical Eagler integration worktree. Promotion follows
[Adaptation Worktree Isolation](adaptation-worktrees.md).

- TH06/TH07 THCRAP source-proof and font records are reusable adaptation guidance.
- A title without verified THCRAP/language-package integration must keep that
  capability unproven until the title-specific path passes.

<!-- knowledge-id: K-THCRAP-001 -->
## Normal design

The formal language preparation chain is:

```text
Host build resolves selected thcrap source
 → format compiler validates/compiles supported resources
 → static language catalog + ZIP with SHA-256 identity
 → Host Manifest / Package Descriptor publishes selected language
 → Launcher validates and installs selected files/fonts
 → Runtime launch
```

Runtime preparation belongs to Host/package tooling, not to the game Runtime
making arbitrary network requests. Keep `/thcrap/th06`, `/thcrap/th07` and
`/thcrap/th08` separate. Static package allowlists should name supported language/feature
files and must not become arbitrary remote code execution. The development
`/api/thcrap` service is useful for live compilation/diagnostics but is not
the formal publication path.
Its HTTP errors always return bounded public messages, including with `?debug=1`.
Internal error messages, stacks and causes stay in server logs because even an
ordinary filesystem error message can reveal a deployment path.

Separate game-original visual authority from ordinary product UI. Desktop TH06 GDI evidence covers font ownership, 2x sizing, Shift-JIS/UTF-8 handling, width, atlas/ANM slots, transparency and logical Draw2 size. SDL_ttf or Web fonts can be a functional fallback; they do not prove pixel parity. Keep font licensing and product UI assets distinct from original game assets.

For TH07 Music Room and long text, line 0 can be an `@` title placeholder and line 1 the description; use render-time pointer binding for long UTF-8 rather than a fixed vanilla buffer. Temporary record counts are observations, not a public format contract.

<!-- knowledge-id: K-THCRAP-002 -->
## Invariants and pitfalls

- Do not launch the Runtime before its selected language resources/fonts are
  actually available and validated.
- Preserve the instruction-site/source checks that prove the intended patch; do not replace semantic proof with a broad success flag.
- A language package that renders text is not automatically a source-proof or visual-parity PASS.
- Keep per-title package/runtime roots and language ownership separate.
- Do not publish original retail data or credentials as part of a convenience package.
- When a conclusion is proven only for one title or title family, label it as
  adopted guidance elsewhere; never silently upgrade it to cross-title proof.
- Treat local image patches according to the patch format's replacement
  semantics, not as an automatic full-texture replacement. TH07 portrait repair
  history showed that transparent/uncovered regions in a local patch can require
  fallback to the original atlas content; replacing the whole source texture can
  erase untouched portrait regions. This is direct TH07 evidence and reusable
  guidance; it is not evidence that TH08 has reproduced the same failure.

## Superseded approaches

Runtime-side arbitrary THCRAP fetching, fixed-buffer long-text binding, temporary record counts as a public contract, and Web-font functional rendering as pixel-parity proof are superseded shortcuts.

## Code anchors

- `integrations/RUNTIME_CONTRACT.md`: formal Host/Launcher/Runtime boundary;
- `lib/content-definition.mjs`: title format-preparation declaration;
- `scripts/prepare-th06-language-pack.mjs`,
  `server/thcrap-compiler.mjs` and `server/thcrap-static-pack.mjs`: current
  TH06/TH07 static pack preparation;
- `server/thcrap-service.mjs`: development live-compiler API only;
- `src/launcher/language-catalog.mts` and Launcher resource installation:
  selectable/static/package language ownership;
- target Runtime localization/file owners: title-specific application/fallback.

## Verification

1. Validate source/compile/static catalog/ZIP identity and Host Manifest/Package
   publication.
2. Check TH06/TH07 path isolation and feature allowlist.
3. Test representative dialog, Music Room, spell, bomb and portrait text with the named font/render path.
4. Inspect source proof, pack identity and Runtime application separately.
5. For a newly adapted title, keep THCRAP integration unproven until its real
   title-specific lane passes.

## Deliberately omitted claims

This playbook does not claim that a title without the optional language profile
supports THCRAP, nor that functional Web-font output proves original GDI pixel
parity.
