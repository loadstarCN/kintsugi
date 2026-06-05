#!/usr/bin/env node
// bootstraps tsx so we can run the TypeScript entry directly in dev;
// production build goes through `tsc -p tsconfig.json` and can ship plain .js.
import { pathToFileURL } from 'node:url';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import('tsx/esm/api').then(async ({ register }) => {
  register();
  const here = dirname(fileURLToPath(import.meta.url));
  const entry = resolve(here, '../src/index.ts');
  const mod = await import(pathToFileURL(entry).href);
  await mod.runCli(process.argv);
}).catch((err) => {
  console.error(err);
  process.exit(1);
});
