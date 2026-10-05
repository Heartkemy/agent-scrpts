import { readdirSync, lstatSync, existsSync, realpathSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { basename, dirname, join, resolve, relative, sep } from 'node:path';

const names = new Set(['node_modules', 'vendor', '.venv', 'venv', '.next', '.nuxt', '.svelte-kit', '.turbo', '.pytest_cache', '__pycache__']);
const skip = new Set(['.git', '.worktrees', 'worktrees', '.agent-scrpts-worktrees', '.runtime']);
const python = ['pyproject.toml', 'requirements.txt', 'requirements.in', 'Pipfile', 'environment.yml'];
export function disposableKind(path: string): string | null {
  const name = basename(path), parent = dirname(path);
  if (!names.has(name)) return null;
  if (name === 'vendor') return existsSync(join(parent, 'composer.json')) ? 'composer' : null;
  if (name === '.venv' || name === 'venv') return existsSync(join(path, 'pyvenv.cfg')) && python.some(file => existsSync(join(parent, file))) ? 'python' : null;
  if (name === '__pycache__' || name === '.pytest_cache') return 'python-cache';
  return existsSync(join(parent, 'package.json')) ? (name === 'node_modules' ? 'npm' : 'js-cache') : null;
}

/** Read-only inventory: names and manifests establish candidates, never permission to delete. */
export function inventoryProjectDisposables(root: string, keep: string[] = []) {
  root = realpathSync(resolve(root));
  const protectedPaths = keep.map(path => realpathSync(resolve(path)));
  const candidates: Array<{ path: string; kind: string; allocatedBytes: number; modified: string }> = [];
  const errors: Array<{ path: string; error: string }> = [];
  let scannedDirectories = 0;
  const under = (path: string, parent: string) => path === parent || path.startsWith(parent + sep);
  function visit(path: string) {
    if (protectedPaths.some(parent => under(path, parent))) return;
    try {
      const stat = lstatSync(path);
      if (!stat.isDirectory() || stat.isSymbolicLink()) return;
      const git = join(path, '.git');
      if (path !== root && existsSync(git) && lstatSync(git).isFile()) return;
      scannedDirectories++;
      if (path !== root && names.has(basename(path))) {
        const kind = disposableKind(path);
        if (kind) {
          const allocatedBytes = Number(execFileSync('du', ['-sk', path], { encoding: 'utf8', timeout: 60000 }).split(/\s+/)[0]) * 1024;
          if (!Number.isSafeInteger(allocatedBytes) || allocatedBytes < 0) throw new Error('Invalid allocated size.');
          candidates.push({ path, kind, allocatedBytes, modified: stat.mtime.toISOString() });
        }
        return; // Never descend into dependencies or ambiguous similarly named directories.
      }
      if (path !== root && skip.has(basename(path))) return;
      for (const entry of readdirSync(path, { withFileTypes: true })) if (entry.isDirectory()) visit(join(path, entry.name));
    } catch (error) {
      errors.push({ path: relative(root, path), error: error instanceof Error ? error.message : String(error) });
    }
  }
  visit(root);
  candidates.sort((a, b) => b.allocatedBytes - a.allocatedBytes);
  return { root, candidates, scannedDirectories, errors, complete: errors.length === 0 };
}
