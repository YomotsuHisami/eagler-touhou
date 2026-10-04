# Engineering playbooks

These playbooks are the long-lived implementation and debugging guidance for
Eagler Touhou. They are distributed with the source repository because they are
useful to both human maintainers and coding agents.

They do **not** define the product by themselves:

- [Adapter capability classification](../ADAPTER_CAPABILITIES.md) says which
  capabilities are required, optional, profile-specific or compatibility-only.
- [Adapter behavior invariants](../ADAPTER_BEHAVIOR_INVARIANTS.md) says which
  user-visible adaptation semantics must remain consistent even when several
  technically valid implementations are possible.
- These playbooks explain implementation ownership, recurring pitfalls,
  superseded approaches and verification methods.

Implementation bugs belong here rather than in the behavior-invariant document.
Workspace-only evidence ledgers, absolute local paths, temporary dirty-tree
state and chat/history pointers intentionally do not belong in the distributed
playbooks.

## Playbook index

- [Input and Touch](input-touch.md)
- [Audio](audio.md)
- [Interpolation and High Refresh](interpolation.md)
- [Performance and Rendering](performance-rendering.md)
- [Web Runtime](web-runtime.md)
- [Replay Determinism](replay-determinism.md)
- [Runtime, Launcher and Package](runtime-launcher-package.md)
- [Localization / THCRAP](localization-thcrap.md)
- [THPrac / Portable Practice](thprac.md)
- [Mobile Browser](mobile-browser.md)
- [Multiplayer](multiplayer.md)
- [Measured Multiplayer Startup](adonis-adaptation.md) - native calibration,
  timing policy, rollback ownership and acceptance gates
- [Rollback](rollback.md) - optimization methodology plus frozen investigation
  records under [`rollback/`](rollback/README.md)
- [Deployment and Network](deployment-network.md)
- [Testing and Acceptance](testing-acceptance.md)
- [Adaptation Worktree Isolation](adaptation-worktrees.md) - required branch/
  worktree separation for upstream tracking and for high-refresh,
  Multiplayer, THPrac and THCRAP adaptation work

## Reading rule

Start with the one playbook that owns the task. Read a second playbook only when
the change crosses a real ownership boundary. For example, a high-refresh Replay
regression starts with interpolation and Replay determinism; an ordinary touch
gesture change starts with Input and Touch.

Code anchors are intentionally repository- or title-relative. A title-specific
playbook rule never overrides that title's authoritative gameplay/source
semantics.

High-refresh, Multiplayer, THPrac and THCRAP work also requires the worktree
isolation playbook. This is intentionally not a blanket requirement for every
adapter edit.

Paths prefixed by a sibling repository name such as `th07-eagler/` or
`eagler-common/` are cross-repository reference anchors. They are available in
the full maintainer workspace, not in a standalone `eagler-touhou` clone.
