# Browser package subsystem

This directory owns Eagler Touhou's **browser-local game package** model. It is
unrelated to npm's root `package.json` despite the short directory name.

The subsystem owns:

- the `eagler-touhou/package/1` descriptor contract;
- generation planning and current/pending installation state;
- IndexedDB Package Store persistence;
- remote/local installation orchestration;
- offline ZIP parsing/import.

New package writes and imports use the canonical Package Store model. Historical
formats that still need read/migration compatibility belong in `legacy/` and
must not grow new producers.

The adjacent `.d.mts` files are narrow TypeScript declaration surfaces for the
retained JavaScript implementation modules. Eliminating declaration bridges is
not an architectural goal by itself.

Launcher-specific presentation and orchestration belong in `src/launcher/`;
package storage/install policy should remain here so it can be tested without
the Launcher UI.


## Confirmed import and removal

`installPackageFromAcquisition` accepts an optional `expectedGenerationId` as a
confirmation fence. A string names the generation the user reviewed; `null`
means they reviewed an uninstalled game. The installer checks this inside its
per-game queue/WebLock, and staging checks it again in the IndexedDB transaction
so another context cannot advance current between review and mutation. Omitting
this option preserves the existing install/update behavior. Reading current for
a fence does not enable reuse when `reuseCurrent: false`: supplied local bytes
remain authoritative.

`removeInstalledPackage` shares that same installer queue and WebLock. Its
`expectedGenerationId` is required. The store's
`detachCurrentPackageGeneration` transaction clears only the matching current
installation pointer and records `removedGenerationId`; a changed generation or
pending mutation rejects removal. The marker is retained through staging and
failed/cancelled imports, and only a successful new Package commit clears it.
It never deletes generations, objects, saves, or Runtime leases. Existing leased
Runtime generations remain usable, and normal Package Store garbage collection
retains its own ownership of eventual storage reclamation. This API does not
promise immediate disk-space recovery.

Cancellation is honored before the detach write begins. A successful commit is
not reported as rolled back because the signal was aborted afterward. A later
local import or published base installation can create a new current generation.

`tests/ui-main/resource-import.test.mjs` covers real ZIP readers and installer
queue logic using synthetic storage ports, plus the detach/stage transaction
logic using a small simulated IndexedDB interface. These are bounded Node tests,
not browser IndexedDB, crash-recovery, lease-expiry, or gameplay conformance.


## Existing-user compatibility maintenance

The new UI's document-lifetime storage coordinator calls the existing legacy
read/adapter/cleanup owner. Complete local imports migrate after first paint;
missing fonts are downloaded only by explicit preparation from validated
same-mount publication declarations. Existing DATA is never downloaded for this
migration. Missing hashes are attested from actual local bytes. A committed
generation is read back and hashed before historical storage is released;
failures retain the original copy. Individual game inspection/preparation waits
only for that game's compatibility work.

The coordinator skips legacy migration when `removedGenerationId` is present.
It additionally passes `rejectRemovedInstallation: true` for fresh migrations;
this is checked inside both the installer queue and staging transaction, closing
the install-then-remove race even when `expectedGenerationId: null` still matches.
Explicit new imports/installs retain their existing behavior and may clear the
marker by committing successfully. No schema change or eager object deletion is
part of this mechanism. Runtime leases and normal GC retain their ownership.

`tests/ui-main/storage-bootstrap.test.mjs` exercises the real historical loader,
adapter and cleanup through injected Package ports and an in-memory cache. Its
results are coordination/integrity evidence, not real-browser durability proof.
