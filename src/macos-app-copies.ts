import { readdir, lstat, realpath } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { join, resolve } from 'node:path';

/** Read-only inventory. Bundle identity, rather than its display name, selects an app. */
export async function inventoryAppCopies(roots: string[], bundleIds: string[], keep: string[] = []) {
  if (process.platform !== 'darwin') throw new Error('This inventory requires macOS plutil and du.');
  if (!roots.length || !bundleIds.length) throw new Error('Supply scan roots and bundle IDs.');
  const seen = new Set<string>(), protectedPaths = new Set(await Promise.all(keep.map(path => realpath(path))));
  const apps: Array<{ path: string; bundleId: string; version: string; allocatedBytes: number; keep: boolean }> = [];
  const errors: Array<{ path: string; error: string }> = [];
  const skip = new Set(['.git', 'node_modules', '.venv', 'venv', 'target', '.next', 'pgdata', 'database', 'native-runtime']);
  async function visit(path: string) {
    try {
      const info = await lstat(path);
      if (!info.isDirectory() || info.isSymbolicLink()) return;
      const canonical = await realpath(path);
      if (seen.has(canonical)) return;
      seen.add(canonical);
      if (path.endsWith('.app')) {
        const plist = join(path, 'Contents/Info.plist');
        const field = (key: string) => execFileSync('/usr/bin/plutil', ['-extract', key, 'raw', '-o', '-', plist], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 3000 }).trim();
        const bundleId = field('CFBundleIdentifier');
        if (bundleIds.includes(bundleId)) {
          const allocatedBytes = Number(execFileSync('/usr/bin/du', ['-sk', path], { encoding: 'utf8', timeout: 30000 }).split(/\s+/)[0]) * 1024;
          if (!Number.isSafeInteger(allocatedBytes) || allocatedBytes < 0) throw new Error('Invalid allocated size.');
          apps.push({ path: canonical, bundleId, version: field('CFBundleShortVersionString'), allocatedBytes, keep: protectedPaths.has(canonical) });
        }
        return; // Helpers belong to their containing app; never count/delete them separately.
      }
      for (const entry of await readdir(path, { withFileTypes: true })) if (entry.isDirectory() && !skip.has(entry.name)) await visit(join(path, entry.name));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') errors.push({ path, error: error instanceof Error ? error.message : String(error) });
    }
  }
  for (const root of roots) await visit(resolve(root));
  apps.sort((a, b) => a.path.localeCompare(b.path));
  return { apps, total: apps.length, allocatedBytes: apps.reduce((sum, app) => sum + app.allocatedBytes, 0), scannedDirectories: seen.size, errors, complete: errors.length === 0 };
}
