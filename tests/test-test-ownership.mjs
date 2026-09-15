/** L0/repository governance. Proves every executable test has exactly one
 * discoverable lane: a default plan or an explicit package command. */
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  REPOSITORY_NODE_TESTS,
  REPOSITORY_PYTHON_TESTS,
  WORKSPACE_NODE_TESTS,
  WORKSPACE_PYTHON_TESTS,
  OPTIONAL_NODE_TESTS,
} from "./test-plan.mjs";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const packageJson = JSON.parse(await readFile(resolve(root, "package.json"), "utf8"));
const explicit = new Set(Object.values(packageJson.scripts || {}).flatMap(command =>
  [...String(command).matchAll(/(?:^|\s)(tests\/[A-Za-z0-9_./-]+\.(?:mjs|py|ps1))(?=\s|$)/g)].map(match => match[1])
));
const planned = new Set([
  ...REPOSITORY_NODE_TESTS, ...REPOSITORY_PYTHON_TESTS,
  ...WORKSPACE_NODE_TESTS, ...WORKSPACE_PYTHON_TESTS,
  ...OPTIONAL_NODE_TESTS,
]);

async function collect(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) files.push(...await collect(path));
    else if (/^test.*\.(?:mjs|py|ps1)$/i.test(entry.name)) files.push(relative(root, path).replaceAll("\\", "/"));
  }
  return files;
}

const exempt = new Set(["tests/test-plan.mjs"]);
const executableTests = (await collect(resolve(root, "tests"))).filter(file => !exempt.has(file));
const unowned = executableTests.filter(file => !planned.has(file) && !explicit.has(file));
assert.deepEqual(unowned, [], `tests without a declared lane: ${unowned.join(", ")}`);

console.log(JSON.stringify({ testOwnership: "PASS", executableTests: executableTests.length }));
