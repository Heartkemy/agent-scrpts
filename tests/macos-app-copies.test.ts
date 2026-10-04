import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { inventoryAppCopies } from '../src/macos-app-copies.ts';

test('app inventory selects exact bundle IDs, deduplicates roots, preserves apps and excludes nested helpers/symlinks', { skip: process.platform !== 'darwin' }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'app-copies-'));
  async function app(path: string, id: string) {
    await mkdir(join(path, 'Contents'), { recursive: true });
    await writeFile(join(path, 'Contents/Info.plist'), `<?xml version="1.0"?><plist version="1.0"><dict><key>CFBundleIdentifier</key><string>${id}</string><key>CFBundleShortVersionString</key><string>1.0</string></dict></plist>`);
  }
  try {
    const keep = join(root, 'Current.app');
    await app(keep, 'test.selected'); await app(join(root, 'Old.app'), 'test.selected');
    await app(join(root, 'Other.app'), 'test.unrelated');
    await app(join(keep, 'Contents/Helper.app'), 'test.selected');
    await symlink(join(root, 'Old.app'), join(root, 'Alias.app'));
    const result = await inventoryAppCopies([root, root], ['test.selected'], [keep]);
    assert.equal(result.complete, true); assert.equal(result.total, 2);
    assert.equal(result.apps.filter(app => app.keep).length, 1);
    assert.ok(result.apps.every(app => app.allocatedBytes > 0));
    assert.equal(result.apps.some(app => app.path.endsWith('Helper.app') || app.path.endsWith('Alias.app')), false);
  } finally { await rm(root, { recursive: true, force: true }); }
});
