import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const serverDir = join(root, 'apps/server');
const envFile = join(root, '.env');

const child = spawn(
  process.execPath,
  [
    `--env-file=${envFile}`,
    '--watch',
    '-r',
    '@swc-node/register',
    join(serverDir, 'src/main.ts'),
    ...process.argv.slice(2),
  ],
  {
    cwd: serverDir,
    stdio: 'inherit',
    env: process.env,
  },
);

child.on('exit', (code) => process.exit(code ?? 0));
process.on('SIGINT', () => child.kill('SIGINT'));
process.on('SIGTERM', () => child.kill('SIGTERM'));
