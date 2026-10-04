#!/usr/bin/env node
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createPublishedSiteServer } from '../server/ui-static-server.mjs';

export { createPublishedSiteServer } from '../server/ui-static-server.mjs';

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = resolve(process.argv[2] || '.');
  const port = Number(process.argv[3] || process.env.EAGLER_TOUHOU_PORT || '8130');
  const host = process.env.EAGLER_TOUHOU_HOST || '127.0.0.1';
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('invalid port');
  const server = await createPublishedSiteServer({ root });
  server.listen(port, host, () => {
    console.log(`Eagler Touhou host: http://${host}:${port}${server.uiMountPath}`);
    console.log(`Serving immutable site directory: ${root}`);
  });
}
