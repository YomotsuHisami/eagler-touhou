import { spawnSync } from "node:child_process";

function run(command, args) {
  const result = spawnSync(command, args, { stdio: "inherit", shell: false });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status || 1);
}

const nodeChecks = [
  "app-shell-sw-src.js", "scripts/build-app-shell.mjs", "app.js", "app-shell-sw.js",
  "game-data-import.mjs", "network-activity.mjs", "package-descriptor.mjs",
  "package-generation.mjs", "package-store.mjs", "runtime-preparation.mjs",
  "package-zip.mjs", "package-installer.mjs", "release-catalog.mjs",
  "product-catalog.mjs", "package-launcher.mjs",
  "scripts/run-launcher-package-first-install-browser-test.mjs",
  "scripts/run-launcher-package-import-browser-test.mjs",
  "scripts/run-playwright-webkit-gate.mjs", "scripts/game-data-layout.mjs",
  "integrations/thcrap.mjs", "integrations/thprac.mjs", "server/thcrap-service.mjs",
  "server/thcrap-compiler.mjs", "server/thcrap-ascii-contract.mjs",
  "server/thcrap-static-pack.mjs", "server/thtk-runner.mjs", "scripts/vendor.mjs",
  "scripts/serve.mjs", "scripts/package-test.mjs", "scripts/package-game-data.mjs",
  "scripts/package-offline-game.mjs", "scripts/package-server.mjs",
  "scripts/verify-test-build.mjs", "scripts/verify-server-build.mjs",
  "scripts/verify-deployed-site.mjs", "scripts/verify-origin-cutover.mjs",
  "scripts/audit-publication.mjs", "scripts/verify-unified-layout.mjs",
  "scripts/verify-dom-contract.mjs", "scripts/prepare-th06-language-pack.mjs",
];

const tests = [
  "verify-dom-contract.mjs", "test-server-feature-contract.mjs", "audit-publication.mjs",
  "test-shell-protocol.mjs", "test-game-data-import.mjs",
  "test-network-activity.mjs", "test-network-visibility-contract.mjs",
  "test-package-descriptor.mjs", "test-package-generation.mjs",
  "test-package-store-contract.mjs", "test-package-zip.mjs",
  "test-package-installer-contract.mjs", "test-release-catalog.mjs",
  "test-package-launcher.mjs", "test-local-launcher-contract.mjs", "test-server.mjs",
];

run(process.execPath, ["scripts/build-app-shell.mjs"]);
for (const file of nodeChecks) run(process.execPath, ["--check", file]);
run("python", ["-m", "py_compile",
  "scripts/subset-font.py",
  "scripts/run-launcher-playwright-webkit.py",
  "scripts/run-import-update-browser.py",
  "scripts/run-ogg-progressive-chromium.py",
]);
for (const test of tests) run(process.execPath, [`scripts/${test}`]);
