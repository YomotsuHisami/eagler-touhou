import argparse
import json

from playwright.sync_api import sync_playwright


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("url", help="same-origin page under eagler-touhou, e.g. http://127.0.0.1:8766/eagler-touhou/faq.html")
    args = parser.parse_args()

    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=True)
        page = browser.new_page()
        page.goto(args.url, wait_until="load", timeout=30_000)
        result = page.evaluate("""async () => {
          const installer = await import('./package-installer.mjs');
          const store = await import('./package-store.mjs');
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

          return {
            failed,
            beforeId: before.installation.currentGeneration,
            afterFailureId: afterFailure.installation.currentGeneration,
            afterFailurePending: afterFailure.installation.pendingGeneration,
            afterFailureRevision: afterFailure.generation.descriptor.revision,
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
          };
        }""")
        browser.close()

    assert result["failed"] and "music: desired Package file is unavailable" in result["failed"], result
    assert result["beforeId"] == result["afterFailureId"], result
    assert result["afterFailurePending"] is None, result
    assert result["afterFailureRevision"] == "r1", result
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
    print(json.dumps({"pass": True, **result}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
