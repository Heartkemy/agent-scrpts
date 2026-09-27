import { mkdirSync, writeFileSync, rmSync, realpathSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { randomBytes } from 'node:crypto';
import { AppError } from './protocol.ts';
import { run, testRepository } from './support.ts';
const git = (root: string, ...args: string[]) => run('git', ['-C', root, ...args]);
function clean(root: string): void { if (git(root, 'status', '--porcelain').trim()) throw new AppError('DIRTY_WORKTREE', `Commit or preserve changes before integration: ${root}`); }
export function withGitLock<T>(root: string, fn: () => T): T {
  const common = resolve(root, git(root, 'rev-parse', '--git-common-dir'));
  const lock = join(common, 'agent-scrpts-integration.lock');
  try { mkdirSync(lock); } catch { throw new AppError('GIT_BUSY', 'Another integration holds the repository lock. Check its owner.json; never remove a live lock.'); }
  try { writeFileSync(join(lock, 'owner.json'), JSON.stringify({ pid: process.pid, created: new Date().toISOString() })); return fn(); }
  finally { rmSync(lock, { recursive: true, force: true }); }
}
export function newWorktree(root: string, slug: string): any {
  if (!/^[a-z0-9][a-z0-9-]{0,48}$/.test(slug)) throw new AppError('USAGE', 'Worktree name must be a lowercase slug, at most 49 characters.');
  return withGitLock(root, () => {
    git(root, 'fetch', 'origin', 'main');
    const token = `${slug}-${Date.now()}-${randomBytes(3).toString('hex')}`;
    const branch = `agent/${token}`, folder = join(dirname(root), '.agent-scrpts-worktrees', token);
    mkdirSync(dirname(folder), { recursive: true });
    // Start from the current remote main. Do not alter someone else's primary checkout.
    git(root, 'worktree', 'add', '-b', branch, folder, 'origin/main');
    return { branch, path: folder, next: 'Work here, test, commit, then: ascr worktree integrate <this-path>' };
  });
}
export function integrate(root: string, supplied: string): any {
  root = realpathSync(root); const worktree = realpathSync(resolve(supplied));
  const managed = realpathSync(join(dirname(root), '.agent-scrpts-worktrees'));
  if (!worktree.startsWith(managed + '/')) throw new AppError('WORKTREE_SCOPE', 'Only worktrees created by this repository can be integrated by this helper.');
  if (resolve(worktree, git(worktree, 'rev-parse', '--git-common-dir')) !== resolve(root, git(root, 'rev-parse', '--git-common-dir'))) throw new AppError('WRONG_REPOSITORY', 'The worktree belongs to a different repository.');
  return withGitLock(root, () => {
    clean(root); clean(worktree);
    if (git(root, 'branch', '--show-current') !== 'main') throw new AppError('MAIN_REQUIRED', 'The primary checkout must be on main.');
    const branch = git(worktree, 'branch', '--show-current');
    if (!branch.startsWith('agent/')) throw new AppError('WORKTREE_SCOPE', 'An agent/* branch is required.');
    git(root, 'fetch', 'origin', 'main');
    const integrationBranch = `integration/${Date.now()}-${randomBytes(4).toString('hex')}`;
    const folder = join(managed, integrationBranch.replace('/', '-'));
    git(root, 'worktree', 'add', '-b', integrationBranch, folder, 'main');
    let pushed = false;
    try {
      git(folder, 'merge', '--no-edit', 'origin/main');
      git(folder, 'merge', '--no-ff', '--no-edit', branch);
      testRepository(folder);
      const sha = git(folder, 'rev-parse', 'HEAD');
      // Fast-forward push only. A remote race rejects the push rather than overwriting work.
      git(folder, 'push', 'origin', 'HEAD:main'); pushed = true;
      clean(root); git(root, 'merge', '--ff-only', sha);
      // Delete only our disposable integration worktree and the explicitly supplied completed one.
      git(root, 'worktree', 'remove', folder); git(root, 'branch', '-d', integrationBranch);
      clean(worktree); git(root, 'worktree', 'remove', worktree); git(root, 'branch', '-d', branch);
      return { status: 'merged-and-pushed', commit: sha, main: root };
    } catch (e) {
      throw new AppError('INTEGRATION_STOPPED', `Integration stopped; work is preserved at ${folder}. ${pushed ? 'The tested merge WAS pushed; reconcile the local main before retrying.' : 'No force push was attempted.'}`, 500, { cause: e instanceof Error ? e.message : String(e) });
    }
  });
}
