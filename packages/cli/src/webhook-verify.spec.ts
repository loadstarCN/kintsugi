/**
 * webhook-verify 子命令端到端：
 * spawn kintsugi 子进程（确保 commander 注册路径真实），喂 body 和 signature，
 * 验退出码 + stdout/stderr。
 */

import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { spawnSync } from 'node:child_process';
import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

const BIN = path.resolve(__dirname, '..', 'bin', 'kintsugi.js');

interface RunResult {
  status: number | null;
  stdout: string;
  stderr: string;
}

function runCli(args: string[], input?: Buffer): RunResult {
  const r = spawnSync('node', [BIN, ...args], {
    input,
    encoding: 'utf8',
    env: { ...process.env, KINTSUGI_API_BASE: 'http://noop' },
  });
  return { status: r.status, stdout: r.stdout, stderr: r.stderr };
}

describe('kintsugi webhook-verify', () => {
  let tmpDir: string;
  beforeAll(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kintsugi-cli-test-'));
  });
  afterAll(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('exits 0 when signature matches', () => {
    const body = Buffer.from('{"event":"dataset.created","id":"ds-1"}');
    const secret = 'whsec_xxx';
    const sig = crypto.createHmac('sha256', secret).update(body).digest('hex');
    const bodyPath = path.join(tmpDir, 'body.json');
    fs.writeFileSync(bodyPath, body);

    const r = runCli([
      'webhook-verify',
      '-s', secret,
      '-b', bodyPath,
      '-S', `sha256=${sig}`,
    ]);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('signature OK');
  });

  it('accepts signature without "sha256=" prefix', () => {
    const body = Buffer.from('hi');
    const secret = 's';
    const sig = crypto.createHmac('sha256', secret).update(body).digest('hex');
    const bodyPath = path.join(tmpDir, 'body2.txt');
    fs.writeFileSync(bodyPath, body);

    const r = runCli(['webhook-verify', '-s', secret, '-b', bodyPath, '-S', sig]);
    expect(r.status).toBe(0);
  });

  it('exits 1 with diagnostic on mismatch', () => {
    const body = Buffer.from('{"a":1}');
    const bodyPath = path.join(tmpDir, 'body3.json');
    fs.writeFileSync(bodyPath, body);

    const r = runCli([
      'webhook-verify',
      '-s', 'real-secret',
      '-b', bodyPath,
      '-S', 'sha256=' + 'a'.repeat(64),
    ]);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('MISMATCH');
    expect(r.stderr).toContain('expected: sha256=');
  });

  it('reads secret from @file', () => {
    const body = Buffer.from('payload');
    const secret = 'file-only-secret';
    const sig = crypto.createHmac('sha256', secret).update(body).digest('hex');
    const bodyPath = path.join(tmpDir, 'body4.bin');
    const secretPath = path.join(tmpDir, 'secret.txt');
    fs.writeFileSync(bodyPath, body);
    fs.writeFileSync(secretPath, secret + '\n'); // trailing newline trimmed

    const r = runCli([
      'webhook-verify',
      '-s', '@' + secretPath,
      '-b', bodyPath,
      '-S', sig,
    ]);
    expect(r.status).toBe(0);
  });

  it('reads body from stdin when -b is "-"', () => {
    const body = Buffer.from('stdin-body');
    const secret = 's';
    const sig = crypto.createHmac('sha256', secret).update(body).digest('hex');

    const r = runCli(['webhook-verify', '-s', secret, '-b', '-', '-S', sig], body);
    expect(r.status).toBe(0);
  });

  it('rejects malformed signature (non-hex) without crashing', () => {
    const body = Buffer.from('x');
    const bodyPath = path.join(tmpDir, 'body6.bin');
    fs.writeFileSync(bodyPath, body);

    const r = runCli([
      'webhook-verify',
      '-s', 's',
      '-b', bodyPath,
      '-S', 'sha256=not-hex-at-all',
    ]);
    expect(r.status).toBe(1);
  });
});
