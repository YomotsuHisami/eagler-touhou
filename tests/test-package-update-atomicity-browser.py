from __future__ import annotations

import json
import socket
import subprocess
import time
import tempfile
from pathlib import Path

from playwright.sync_api import sync_playwright


PROJECT = Path(__file__).resolve().parents[1]


def free_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.bind(("127.0.0.1", 0))
        return int(sock.getsockname()[1])


def wait_http(url: str, timeout: float = 10.0) -> None:
    import urllib.request

    deadline = time.time() + timeout
    while time.time() < deadline:
        try:
            with urllib.request.urlopen(url, timeout=0.5) as response:
                if response.status < 400:
                    return
        except Exception:
            time.sleep(0.1)
    raise RuntimeError(f"HTTP server did not start: {url}")


def main() -> int:
    http_port = free_port()
    # An inert browser origin and the actual compiled Package module closure:
    # no game resources or application/dev metadata are required by this lane.
    fixture = tempfile.TemporaryDirectory(prefix="package-browser-")
    site = Path(fixture.name) / "site"
    subprocess.run(["node", "tests/support/build-package-browser-fixture.mjs", str(site)], cwd=PROJECT, check=True)
    url = f"http://127.0.0.1:{http_port}/"
    http = subprocess.Popen(
        ["node", str(PROJECT / "scripts" / "serve-static.mjs"), str(site), str(http_port)],
        cwd=PROJECT,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        text=True,
    )
    try:
        wait_http(f"http://127.0.0.1:{http_port}/package/package-store.mjs")
        with sync_playwright() as playwright:
            browser = playwright.chromium.launch(headless=True)
            page = browser.new_page()
            page.goto(url, wait_until="load", timeout=30_000)
            result = page.evaluate("""async () => {
          const installer = await import('./package/package-installer.mjs');
          const launcher = await import('./package/package-launcher.mjs');
          const store = await import('./package/package-store.mjs');
          await new Promise((resolve, reject) => {
            const request = indexedDB.deleteDatabase(store.PACKAGE_STORE_DB);
            request.onsuccess = () => resolve();
            request.onerror = () => reject(request.error);
            request.onblocked = () => reject(new Error('Package Store delete blocked'));
          });
          let watchdog = null;
          try {
            await store.openPackageStore({ open() { return {}; } }, { timeoutMs: 5 });
          } catch (error) {
            watchdog = String(error?.message || error);
          }
          const makeDescriptor = (revision, optRevision = null) => ({
            schema: 'eagler-touhou/package/1',
            game: 'th06',
            revision,
            runtimeRequirement: {
              protocol: 'eagler-touhou/1',
              target: 'th06',
              dataFile: 'data',
              dataLayout: 'layout-test',
            },
            files: {
              data: { source: 'game/data.bin', target: '/game/data.bin', revision: 'data-r1', bytes: 4 },
              ...(optRevision ? { music: { source: 'music/01.ogg', target: '/music/01.ogg', revision: optRevision, bytes: 3 } } : {}),
            },
            base: { files: ['data'] },
            components: { ogg: { type: 'ogg', files: optRevision ? ['music'] : [] } },
          });

          const first = makeDescriptor('r1', 'music-r1');
          await installer.installPackageFromAcquisition({
            descriptor: first,
            desiredFileIds: ['data', 'music'],
            source: 'local',
            reuseCurrent: false,
            acquire: async fileId => new Blob([fileId === 'data' ? new Uint8Array([1,2,3,4]) : new Uint8Array([5,6,7])]),
          });
          const before = await store.readCurrentPackageGeneration('th06');
          const firstObjectIds = Object.values(before.generation.files).map(ref => ref.objectId);
          const bulk = await store.readPackageObjects(firstObjectIds);
          const dataRef = before.generation.files.data;
          const dataObject = await store.readPackageObject(dataRef.objectId);
          const bySource = await store.readPackageObjectBySource('th06', before.generation.id, 'game/data.bin');
          const missingBySource = await store.readPackageObjectBySource('th06', before.generation.id, 'missing.bin');
          const rawDataObject = await new Promise((resolve, reject) => {
            const request = indexedDB.open(store.PACKAGE_STORE_DB);
            request.onsuccess = () => {
              const db = request.result;
              const tx = db.transaction([store.PACKAGE_OBJECTS], 'readonly');
              const get = tx.objectStore(store.PACKAGE_OBJECTS).get(dataRef.objectId);
              get.onsuccess = () => { resolve(get.result || null); db.close(); };
              get.onerror = () => { reject(get.error); db.close(); };
            };
            request.onerror = () => reject(request.error);
          });

          // Simulate a browser refresh/crash after a Web-Lock-protected
          // Package mutation staged its generation but before normal cleanup.
          // The next document can acquire the same Web Lock immediately, so
          // that stale pending generation must not impose the 2-minute legacy
          // pending timeout.
          const refreshOrphanDescriptor = makeDescriptor('r-refresh-orphan', null);
          refreshOrphanDescriptor.game = 'th10';
          refreshOrphanDescriptor.runtimeRequirement.target = 'th10';
          await store.stagePendingPackageGeneration({
            id: 'gen-refresh-orphan',
            game: 'th10',
            descriptor: refreshOrphanDescriptor,
            files: {},
          }, {
            source: 'remote',
            operationId: 'op-refresh-orphan',
            webLockHeld: true,
          });
          const refreshPendingBefore = await store.readCurrentPackageGeneration('th10');
          const refreshRecoveryDescriptor = makeDescriptor('r-refresh-recovered', null);
          refreshRecoveryDescriptor.game = 'th10';
          refreshRecoveryDescriptor.runtimeRequirement.target = 'th10';
          refreshRecoveryDescriptor.files.data.revision = 'data-refresh-recovered';
          const refreshRecoveryStarted = performance.now();
          await installer.installPackageFromAcquisition({
            descriptor: refreshRecoveryDescriptor,
            desiredFileIds: ['data'],
            source: 'local',
            reuseCurrent: false,
            acquire: async () => new Uint8Array([71, 72, 73, 74]).buffer,
          });
          const refreshRecoveryMs = performance.now() - refreshRecoveryStarted;
          const refreshRecovered = await store.readCurrentPackageGeneration('th10');

          let failed = null;
          try {
            const changed = makeDescriptor('r2', 'music-r2');
            await installer.installPackageFromRemote(changed, {
              descriptorUrl: new URL('./th06.package.json', location.href).href,
              desiredFileIds: ['data', 'music'],
              fetchImpl: async url => {
                if (String(url).endsWith('/music/01.ogg')) return new Response(null, { status: 404 });
                throw new Error(`unexpected fetch: ${url}`);
              },
            });
          } catch (error) {
            failed = String(error?.message || error);
          }
          const afterFailure = await store.readCurrentPackageGeneration('th06');

          let missingBase = null;
          try {
            const incomplete = makeDescriptor('r1-incomplete', null);
            await installer.installParsedPackageZip({
              descriptor: incomplete,
              files: new Map(),
            });
          } catch (error) {
            missingBase = String(error?.message || error);
          }
          const afterMissingBase = await store.readCurrentPackageGeneration('th06');

          const abortController = new AbortController();
          let abortSignalForwarded = false;
          let abortName = null;
          let abortMessage = null;
          try {
            const aborted = makeDescriptor('r2-abort', null);
            aborted.files.data.revision = 'data-abort';
            await installer.installPackageFromRemote(aborted, {
              descriptorUrl: new URL('./th06.package.json', location.href).href,
              desiredFileIds: ['data'],
              signal: abortController.signal,
              fetchImpl: async (_url, options) => {
                abortSignalForwarded = options?.signal === abortController.signal;
                abortController.abort();
                throw new DOMException('cancelled by test', 'AbortError');
              },
            });
          } catch (error) {
            abortName = error?.name || null;
            abortMessage = String(error?.message || error);
          }
          const afterAbort = await store.readCurrentPackageGeneration('th06');

          let sizeMismatch = null;
          try {
            const badSized = makeDescriptor('r2-size', null);
            await installer.installPackageFromAcquisition({
              descriptor: badSized,
              desiredFileIds: ['data'],
              source: 'local',
              reuseCurrent: false,
              acquire: async () => new Uint8Array([9,8,7,6,5]).buffer,
            });
          } catch (error) {
            sizeMismatch = String(error?.message || error);
          }
          const afterSizeMismatch = await store.readCurrentPackageGeneration('th06');

          let removedAcquireCount = 0;
          const removed = makeDescriptor('r3', null);
          await installer.installPackageFromAcquisition({
            descriptor: removed,
            desiredFileIds: ['data'],
            source: 'local',
            reuseCurrent: true,
            acquire: async () => {
              removedAcquireCount++;
              return new Blob([new Uint8Array([9])]);
            },
          });
          const afterRemoval = await store.readCurrentPackageGeneration('th06');

          let sizeFailure = null;
          try {
            const wrongSize = makeDescriptor('r4', null);
            wrongSize.files.data.revision = 'data-r4';
            await installer.installPackageFromAcquisition({
              descriptor: wrongSize,
              desiredFileIds: ['data'],
              source: 'local',
              reuseCurrent: true,
              acquire: async () => new Uint8Array([1, 2, 3, 4, 5]).buffer,
            });
          } catch (error) {
            sizeFailure = String(error?.message || error);
          }
          const afterSizeFailure = await store.readCurrentPackageGeneration('th06');

          const successOrphanId = 'obj-0000000000000001';
          await store.putPackageObject(new Blob([new Uint8Array([11, 12, 13])]), { objectId: successOrphanId });
          const localBefore = await store.readCurrentPackageGeneration('th06');
          const previousLocalDataObjectId = localBefore.generation.files.data.objectId;
          const localDescriptor = makeDescriptor('r5-local', null);
          const localBytes = new Uint8Array([20, 21, 22, 23]);
          await installer.installParsedPackageZip({
            descriptor: localDescriptor,
            files: new Map([['data', { blob: new Blob([localBytes]) }]]),
          });
          const afterLocalImport = await store.readCurrentPackageGeneration('th06');
          const localDataRef = afterLocalImport.generation.files.data;
          const localDataObject = await store.readPackageObject(localDataRef.objectId);
          const successOrphanBeforeGc = await store.readPackageObject(successOrphanId);

          const publishedAbortController = new AbortController();
          const publishedDescriptor = makeDescriptor('r6-published-abort', null);
          publishedDescriptor.files.data.revision = 'data-published-abort';
          const publishedCatalog = {
            schema: 'eagler-touhou/release-catalog/1',
            games: {
              th06: { revision: publishedDescriptor.revision, descriptor: './th06.package.json' },
            },
          };
          let publishedDescriptorSignalForwarded = false;
          let publishedFileSignalForwarded = false;
          let publishedAbortName = null;
          let publishedAbortMessage = null;
          try {
            await launcher.installPublishedPackage('th06', {
              catalog: publishedCatalog,
              catalogUrl: new URL('./release-catalog.json', location.href).href,
              signal: publishedAbortController.signal,
              fetchImpl: async (requestUrl, options) => {
                const request = String(requestUrl);
                if (request.endsWith('/th06.package.json')) {
                  publishedDescriptorSignalForwarded = options?.signal === publishedAbortController.signal;
                  return new Response(JSON.stringify(publishedDescriptor), {
                    status: 200,
                    headers: { 'content-type': 'application/json' },
                  });
                }
                if (request.endsWith('/game/data.bin')) {
                  publishedFileSignalForwarded = options?.signal === publishedAbortController.signal;
                  publishedAbortController.abort();
                  throw new DOMException('cancelled published file fetch', 'AbortError');
                }
                throw new Error(`unexpected published fetch: ${request}`);
              },
            });
          } catch (error) {
            publishedAbortName = error?.name || null;
            publishedAbortMessage = String(error?.message || error);
          }
          const afterPublishedAbort = await store.readCurrentPackageGeneration('th06');
          const successOrphanAfterFailure = await store.readPackageObject(successOrphanId);

          const gcOrphanId = 'obj-0000000000000002';
          await store.putPackageObject(new Blob([new Uint8Array([31, 32, 33])]), { objectId: gcOrphanId });
          const gc = await store.garbageCollectPackageStore();
          const orphanAfterGc = await store.readPackageObject(gcOrphanId);
          const cacheNames = await caches.keys();

          const concurrentEvents = [];
          let releaseFirstMutation;
          let noteFirstMutationStarted;
          const firstMutationGate = new Promise(resolve => { releaseFirstMutation = resolve; });
          const firstMutationStarted = new Promise(resolve => { noteFirstMutationStarted = resolve; });
          const concurrentFirst = makeDescriptor('r7-concurrent-first', null);
          concurrentFirst.files.data.revision = 'data-r7-first';
          const concurrentSecond = makeDescriptor('r8-concurrent-second', null);
          concurrentSecond.files.data.revision = 'data-r8-second';
          const firstMutation = installer.installPackageFromAcquisition({
            descriptor: concurrentFirst,
            desiredFileIds: ['data'],
            source: 'local',
            reuseCurrent: false,
            acquire: async () => {
              concurrentEvents.push('first:start');
              noteFirstMutationStarted();
              await firstMutationGate;
              concurrentEvents.push('first:end');
              return new Uint8Array([41, 42, 43, 44]).buffer;
            },
          });
          await firstMutationStarted;
          const secondMutation = installer.installPackageFromAcquisition({
            descriptor: concurrentSecond,
            desiredFileIds: ['data'],
            source: 'local',
            reuseCurrent: false,
            acquire: async () => {
              concurrentEvents.push('second:start');
              return new Uint8Array([51, 52, 53, 54]).buffer;
            },
          });
          await Promise.resolve();
          const eventsBeforeRelease = [...concurrentEvents];
          releaseFirstMutation();
          await Promise.all([firstMutation, secondMutation]);
          const afterConcurrentMutations = await store.readCurrentPackageGeneration('th06');

          const makeLanguageDescriptor = (revision, languageRevision) => ({
            schema: 'eagler-touhou/package/1',
            game: 'th06',
            revision,
            runtimeRequirement: {
              protocol: 'eagler-touhou/1',
              target: 'th06',
              dataFile: 'data',
              dataLayout: 'layout-test',
            },
            files: {
              data: { source: 'game/data.bin', target: '/game/data.bin', revision: 'language-data-r1', bytes: 4 },
              zh: { source: 'language/zh.zip', target: '/__eagler/language/lang_zh-hans.zip', revision: `zh-${languageRevision}`, bytes: 2 },
              en: { source: 'language/en.zip', target: '/__eagler/language/lang_en.zip', revision: `en-${languageRevision}`, bytes: 3 },
            },
            base: { files: ['data'] },
            components: { language: { type: 'language', entries: [
              { id: 'lang_zh-hans', file: 'zh' },
              { id: 'lang_en', file: 'en' },
            ] } },
          });
          const importedAllLanguages = makeLanguageDescriptor('r9-import-all-languages', 'r1');
          await installer.installPackageFromAcquisition({
            descriptor: importedAllLanguages,
            desiredFileIds: ['data', 'zh', 'en'],
            source: 'local',
            reuseCurrent: false,
            acquire: async fileId => new Blob([fileId === 'data'
              ? new Uint8Array([61, 62, 63, 64])
              : fileId === 'zh' ? new Uint8Array([65, 66]) : new Uint8Array([67, 68, 69])]),
          });
          const selectedLanguageRequests = [];
          const selectedLanguageUpdate = makeLanguageDescriptor('r10-selected-language', 'r2');
          const selectedLanguageCatalog = {
            schema: 'eagler-touhou/release-catalog/1',
            games: { th06: { revision: selectedLanguageUpdate.revision, descriptor: './th06.package.json' } },
          };
          await launcher.installPublishedPackage('th06', {
            catalog: selectedLanguageCatalog,
            catalogUrl: new URL('./release-catalog.json', location.href).href,
            selectedComponentEntries: { language: ['lang_zh-hans'] },
            fetchImpl: async requestUrl => {
              const request = String(requestUrl);
              selectedLanguageRequests.push(new URL(request).pathname);
              if (request.endsWith('/th06.package.json')) {
                return new Response(JSON.stringify(selectedLanguageUpdate), {
                  status: 200,
                  headers: { 'content-type': 'application/json' },
                });
              }
              if (request.endsWith('/language/zh.zip')) return new Response(new Uint8Array([70, 71]));
              throw new Error(`unexpected selected-language update fetch: ${request}`);
            },
          });
          const afterSelectedLanguageUpdate = await store.readCurrentPackageGeneration('th06');

          const missingObjectDescriptor = makeLanguageDescriptor('r11-missing-object', 'r2');
          const missingObjectId = afterSelectedLanguageUpdate.generation.files.data.objectId;
          await new Promise((resolve, reject) => {
            const request = indexedDB.open(store.PACKAGE_STORE_DB);
            request.onsuccess = () => {
              const db = request.result;
              const transaction = db.transaction([store.PACKAGE_OBJECTS], 'readwrite');
              transaction.objectStore(store.PACKAGE_OBJECTS).delete(missingObjectId);
              transaction.oncomplete = () => { db.close(); resolve(); };
              transaction.onerror = () => { db.close(); reject(transaction.error); };
              transaction.onabort = () => { db.close(); reject(transaction.error); };
            };
            request.onerror = () => reject(request.error);
          });
          let missingObjectFetches = [];
          await installer.installPackageFromRemote(missingObjectDescriptor, {
            descriptorUrl: new URL('./th06.package.json', location.href).href,
            desiredFileIds: ['data'],
            fetchImpl: async url => {
              missingObjectFetches.push(String(url));
              if (String(url).endsWith('/game/data.bin')) return new Response(new Uint8Array([1,2,3,4]));
              throw new Error(`unexpected fetch: ${url}`);
            },
          });
          const afterMissingObject = await store.readCurrentPackageGeneration('th06');
          const repairedMissingObject = await store.readPackageObject(afterMissingObject.generation.files.data.objectId);

          // Even when there are no unchanged candidates, same-revision files
          // with a changed identity must not drop out of the forced fetch set.
          const changedIdentityDescriptor = structuredClone(missingObjectDescriptor);
          changedIdentityDescriptor.files.data.bytes = 5;
          let changedIdentityFetches = 0;
          await installer.installPackageFromRemote(changedIdentityDescriptor, {
            descriptorUrl: new URL('./th06.package.json', location.href).href,
            desiredFileIds: ['data'],
            fetchImpl: async () => {
              changedIdentityFetches++;
              return new Response(new Uint8Array([1,2,3,4,5]));
            },
          });
          const afterChangedIdentity = await store.readCurrentPackageGeneration('th06');
          const changedIdentityObject = await store.readPackageObject(afterChangedIdentity.generation.files.data.objectId);

          const sharedBytes = new Uint8Array([91, 92, 93, 94]);
          const sharedSha256 = '9fcddc31b255e23ec66fc550aefc3b127be6d3e05a3438279cf9d3afe5abf251';
          const legacyShortRevision = makeDescriptor('r12-legacy-short-revision', null);
          legacyShortRevision.files.data.revision = sharedSha256.slice(0, 16);
          await installer.installPackageFromAcquisition({
            descriptor: legacyShortRevision,
            desiredFileIds: ['data'],
            source: 'local',
            reuseCurrent: false,
            acquire: async () => sharedBytes,
          });
          const beforeLegacyUpgrade = await store.readCurrentPackageGeneration('th06');
          let legacyUpgradeFetches = 0;
          const fullHashRevision = structuredClone(legacyShortRevision);
          fullHashRevision.revision = 'r13-full-hash';
          fullHashRevision.files.data.sha256 = sharedSha256;
          await installer.installPackageFromRemote(fullHashRevision, {
            descriptorUrl: new URL('./th06.package.json', location.href).href,
            desiredFileIds: ['data'],
            fetchImpl: async () => {
              legacyUpgradeFetches++;
              throw new Error('legacy object should have been verified locally');
            },
          });
          const afterLegacyUpgrade = await store.readCurrentPackageGeneration('th06');
          const attestedLegacyObject = await store.readPackageObject(afterLegacyUpgrade.generation.files.data.objectId);

          let crossGameFetches = 0;
          const crossGameDescriptor = structuredClone(fullHashRevision);
          crossGameDescriptor.game = 'th07';
          crossGameDescriptor.revision = 'r1-cross-game';
          crossGameDescriptor.runtimeRequirement.target = 'th07';
          await installer.installPackageFromRemote(crossGameDescriptor, {
            descriptorUrl: new URL('./th07.package.json', location.href).href,
            desiredFileIds: ['data'],
            fetchImpl: async () => {
              crossGameFetches++;
              throw new Error('verified cross-game object should have been reused');
            },
          });
          const afterCrossGameInstall = await store.readCurrentPackageGeneration('th07');

          return {
            packageDb: store.PACKAGE_STORE_DB,
            wasmMime: store.packageMimeType('games/th08/th08.wasm'),
            oggMime: store.packageMimeType('music/track.ogg'),
            watchdog,
            bulkSize: bulk.size,
            dataStoredAsArrayBuffer: rawDataObject?.data instanceof ArrayBuffer && !('blob' in rawDataObject),
            normalizedBlob: dataObject?.data instanceof ArrayBuffer && dataObject?.blob instanceof Blob,
            dataStorageMode: dataRef.storageMode || null,
            refreshPendingWebLock: refreshPendingBefore.installation.pendingWebLock,
            refreshRecoveryMs,
            refreshRecoveryRevision: refreshRecovered.generation.descriptor.revision,
            refreshRecoveryPending: refreshRecovered.installation.pendingGeneration,
            bySourceFileId: bySource?.fileId || null,
            missingBySource: missingBySource === null,
            gcObjectsDeleted: gc.objectsDeleted,
            orphanCollected: orphanAfterGc === null,
            cacheNames,
            failed,
            missingBase,
            missingBaseCurrentId: afterMissingBase.installation.currentGeneration,
            missingBasePending: afterMissingBase.installation.pendingGeneration,
            missingObjectFetches,
            missingObjectRepaired: afterMissingObject.generation.files.data.objectId !== missingObjectId,
            missingObjectBytes: repairedMissingObject?.data?.byteLength || null,
            changedIdentityFetches,
            changedIdentityBytes: changedIdentityObject?.data?.byteLength || null,
            beforeId: before.installation.currentGeneration,
            afterFailureId: afterFailure.installation.currentGeneration,
            afterFailurePending: afterFailure.installation.pendingGeneration,
            afterFailureRevision: afterFailure.generation.descriptor.revision,
            abortSignalForwarded,
            abortName,
            abortMessage,
            afterAbortId: afterAbort.installation.currentGeneration,
            afterAbortPending: afterAbort.installation.pendingGeneration,
            afterAbortRevision: afterAbort.generation.descriptor.revision,
            sizeMismatch,
            afterSizeMismatchId: afterSizeMismatch.installation.currentGeneration,
            afterSizeMismatchPending: afterSizeMismatch.installation.pendingGeneration,
            afterSizeMismatchRevision: afterSizeMismatch.generation.descriptor.revision,
            afterRemovalRevision: afterRemoval.generation.descriptor.revision,
            afterRemovalHasMusic: !!afterRemoval.generation.files.music,
            removedAcquireCount,
            sizeFailure,
            afterSizeFailureRevision: afterSizeFailure.generation.descriptor.revision,
            afterSizeFailurePending: afterSizeFailure.installation.pendingGeneration,
            localImportRevision: afterLocalImport.generation.descriptor.revision,
            localImportObjectChanged: localDataRef.objectId !== previousLocalDataObjectId,
            localImportBytes: Array.from(new Uint8Array(localDataObject.data)),
            localImportStorageMode: localDataRef.storageMode || null,
            successDeferredGc: successOrphanBeforeGc !== null,
            publishedDescriptorSignalForwarded,
            publishedFileSignalForwarded,
            publishedAbortName,
            publishedAbortMessage,
            afterPublishedAbortRevision: afterPublishedAbort.generation.descriptor.revision,
            afterPublishedAbortPending: afterPublishedAbort.installation.pendingGeneration,
            failureCollectedDeferredOrphan: successOrphanAfterFailure === null,
            eventsBeforeRelease,
            concurrentEvents,
            concurrentRevision: afterConcurrentMutations.generation.descriptor.revision,
            concurrentPending: afterConcurrentMutations.installation.pendingGeneration,
            selectedLanguageRequests,
            selectedLanguageFiles: Object.keys(afterSelectedLanguageUpdate.generation.files).sort(),
            selectedLanguageSource: afterSelectedLanguageUpdate.installation.source,
            legacyUpgradeFetches,
            legacyUpgradeObjectReused: afterLegacyUpgrade.generation.files.data.objectId === beforeLegacyUpgrade.generation.files.data.objectId,
            legacyUpgradeAttestedSha256: attestedLegacyObject?.sha256 || null,
            crossGameFetches,
            crossGameObjectReused: afterCrossGameInstall.generation.files.data.objectId === afterLegacyUpgrade.generation.files.data.objectId,
          };
        }""")
            browser.close()

        assert result["packageDb"] == "eagler-touhou-package-store-v1", result
        assert result["wasmMime"] == "application/wasm", result
        assert result["oggMime"] == "audio/ogg", result
        assert result["watchdog"] and "Package Store open timed out" in result["watchdog"], result
        assert result["bulkSize"] == 2, result
        assert result["dataStoredAsArrayBuffer"] is True, result
        assert result["normalizedBlob"] is True, result
        assert result["dataStorageMode"] == "arraybuffer", result
        assert result["refreshPendingWebLock"] is True, result
        assert result["refreshRecoveryMs"] < 10_000, result
        assert result["refreshRecoveryRevision"] == "r-refresh-recovered", result
        assert result["refreshRecoveryPending"] is None, result
        assert result["bySourceFileId"] == "data", result
        assert result["missingBySource"] is True, result
        assert result["gcObjectsDeleted"] >= 1, result
        assert result["orphanCollected"] is True, result
        assert result["cacheNames"] == [], result
        assert result["failed"] and "music: desired Package file is unavailable" in result["failed"], result
        assert result["missingBase"] and "Package ZIP is missing required base files: data" in result["missingBase"], result
        assert result["missingBaseCurrentId"] == result["afterFailureId"], result
        assert result["missingBasePending"] is None, result
        assert result["missingObjectFetches"] == ["http://127.0.0.1:%d/game/data.bin" % http_port], result
        assert result["missingObjectRepaired"] is True, result
        assert result["missingObjectBytes"] == 4, result
        assert result["changedIdentityFetches"] == 1, result
        assert result["changedIdentityBytes"] == 5, result
        assert result["beforeId"] == result["afterFailureId"], result
        assert result["afterFailurePending"] is None, result
        assert result["afterFailureRevision"] == "r1", result
        assert result["abortSignalForwarded"] is True, result
        assert result["abortName"] == "AbortError", result
        assert result["abortMessage"] == "已取消下载", result
        assert result["afterAbortId"] == result["beforeId"], result
        assert result["afterAbortPending"] is None, result
        assert result["afterAbortRevision"] == "r1", result
        assert result["sizeMismatch"] and "Package file size mismatch (5/4)" in result["sizeMismatch"], result
        assert result["afterSizeMismatchId"] == result["beforeId"], result
        assert result["afterSizeMismatchPending"] is None, result
        assert result["afterSizeMismatchRevision"] == "r1", result
        assert result["afterRemovalRevision"] == "r3", result
        assert result["afterRemovalHasMusic"] is False, result
        assert result["removedAcquireCount"] == 0, result
        assert result["sizeFailure"] and "Package file size mismatch (5/4)" in result["sizeFailure"], result
        assert result["afterSizeFailureRevision"] == "r3", result
        assert result["afterSizeFailurePending"] is None, result
        assert result["localImportRevision"] == "r5-local", result
        assert result["localImportObjectChanged"] is True, result
        assert result["localImportBytes"] == [20, 21, 22, 23], result
        assert result["localImportStorageMode"] == "arraybuffer", result
        assert result["successDeferredGc"] is True, result
        assert result["publishedDescriptorSignalForwarded"] is True, result
        assert result["publishedFileSignalForwarded"] is True, result
        assert result["publishedAbortName"] == "AbortError", result
        assert result["publishedAbortMessage"] == "已取消下载", result
        assert result["afterPublishedAbortRevision"] == "r5-local", result
        assert result["afterPublishedAbortPending"] is None, result
        assert result["failureCollectedDeferredOrphan"] is True, result
        assert result["eventsBeforeRelease"] == ["first:start"], result
        assert result["concurrentEvents"] == ["first:start", "first:end", "second:start"], result
        assert result["concurrentRevision"] == "r8-concurrent-second", result
        assert result["concurrentPending"] is None, result
        assert result["selectedLanguageRequests"] == ["/th06.package.json", "/language/zh.zip"], result
        assert result["selectedLanguageFiles"] == ["data", "zh"], result
        assert result["selectedLanguageSource"] == "local", result
        assert result["legacyUpgradeFetches"] == 0, result
        assert result["legacyUpgradeObjectReused"] is True, result
        assert result["legacyUpgradeAttestedSha256"] == "9fcddc31b255e23ec66fc550aefc3b127be6d3e05a3438279cf9d3afe5abf251", result
        assert result["crossGameFetches"] == 0, result
        assert result["crossGameObjectReused"] is True, result
        print(json.dumps({"pass": True, **result}, ensure_ascii=False))
        return 0
    finally:
        http.terminate()
        try:
            http.wait(timeout=5)
        except subprocess.TimeoutExpired:
            http.kill()
            http.wait(timeout=5)
        fixture.cleanup()


if __name__ == "__main__":
    raise SystemExit(main())
