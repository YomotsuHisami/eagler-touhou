import {readFileSync} from 'node:fs';

/** Independent of frontend/artifact selection; original attribute mode is default. */
export function runtimeDocumentObservationScript(env = process.env) {
  const mode = env.EAGLER_RUNTIME_TEST_OBSERVATION ?? 'attribute';
  if (mode !== 'attribute' && mode !== 'document') throw new Error('EAGLER_RUNTIME_TEST_OBSERVATION must be attribute or document');
  return mode === 'document' ? readFileSync(new URL('./runtime-document-observation.js', import.meta.url), 'utf8') : null;
}

export async function installRuntimeDocumentObservation(page) {
  const source = runtimeDocumentObservationScript();
  if (source !== null) await page.evaluateOnNewDocument(source);
}
