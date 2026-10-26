import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const cli = fileURLToPath(new URL('../src/cli.ts', import.meta.url));

test('public CLI lists and runs tools without a local runtime configuration', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ascr-public-cli-'));
  try {
    const env = { ...process.env, ASCR_CONFIG: join(dir, 'missing-config.json') };
    const tools = spawnSync(process.execPath, ['--experimental-strip-types', '--disable-warning=ExperimentalWarning', cli, 'tools'], { encoding: 'utf8', env });
    assert.equal(tools.status, 0, tools.stderr);
    assert.ok(JSON.parse(tools.stdout).some((tool: { name: string }) => tool.name === 'json-pick'));
    const pick = spawnSync(process.execPath, ['--experimental-strip-types', '--disable-warning=ExperimentalWarning', cli, 'run', 'json-pick', '/answer'], { encoding: 'utf8', input: '{"answer":42}', env });
    assert.equal(pick.status, 0, pick.stderr);
    assert.equal(pick.stdout.trim(), '42');
    assert.equal(existsSync(join(dir, 'missing-config.json')), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
