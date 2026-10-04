#!/usr/bin/env node
import {resolve} from 'node:path';
import {assembleUiPublication} from '../lib/ui-publication.mjs';
const args = {};
for (const value of process.argv.slice(2)) {
  const match = /^--(source|ui|output|mount)=(.+)$/.exec(value);
  if (!match || args[match[1]]) throw new Error('Usage: node scripts/assemble-ui-publication.mjs --source=VERIFIED_SITE --ui=FRAMEWORK_CLIENT --output=NEW_DIRECTORY [--mount=/]');
  args[match[1]] = match[2];
}
if (!args.source || !args.ui || !args.output) throw new Error('Explicit --source, --ui and --output are required');
const result = await assembleUiPublication({sourceRoot: resolve(args.source), uiRoot: resolve(args.ui), outputRoot: resolve(args.output), mountPath: args.mount || '/'});
console.log(JSON.stringify({outputRoot: result.outputRoot, buildId: result.buildId, shellFiles: result.shellFiles, status: result.publication.status}, null, 2));
console.log('\nOptional nginx navigation fragment (not installed):\n' + result.nginxNavigation);
