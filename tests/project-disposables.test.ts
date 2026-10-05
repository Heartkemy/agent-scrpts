import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, rmSync, existsSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { inventoryProjectDisposables } from '../src/project-disposables.ts';

test('inventory preserves files and excludes protected projects, worktrees, symlinks and ambiguous vendors', () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'project-disposables-')));
  try {
    for (const project of ['old', 'active', '.worktrees/old', 'linked-checkout']) {
      mkdirSync(join(root, project, 'node_modules/nested/node_modules'), { recursive: true });
      writeFileSync(join(root, project, 'package.json'), '{}');
      writeFileSync(join(root, project, 'node_modules/file'), 'installed dependency');
    }
    writeFileSync(join(root, 'linked-checkout/.git'), 'gitdir: ../old/.git/worktrees/linked-checkout');
    mkdirSync(join(root, 'old/vendor'));
    symlinkSync(join(root, 'old'), join(root, 'alias'));
    const result = inventoryProjectDisposables(root, [join(root, 'active')]);
    assert.equal(result.complete, true);
    assert.deepEqual(result.candidates.map(item => item.path), [join(root, 'old/node_modules')]);
    assert.ok(result.candidates[0].allocatedBytes > 0);
    assert.ok(existsSync(join(root, 'old/node_modules/file')));
  } finally { rmSync(root, { recursive: true, force: true }); }
});
