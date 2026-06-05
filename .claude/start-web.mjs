import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const webDir = join(root, 'apps/web');
const viteBin = join(webDir, 'node_modules/vite/bin/vite.js');

const child = spawn(
  process.execPath,
  [viteBin, '--host', '127.0.0.1', ...process.argv.slice(2)],
  {
    cwd: webDir,
    stdio: 'inherit',
    env: process.env,
  },
);

child.on('exit', (code) => process.exit(code ?? 0));
process.on('SIGINT', () => child.kill('SIGINT'));
process.on('SIGTERM', () => child.kill('SIGTERM'));
