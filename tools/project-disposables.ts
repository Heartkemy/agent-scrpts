import { parseArgs } from 'node:util';
import { inventoryProjectDisposables } from '../src/project-disposables.ts';

try {
  const { values, positionals } = parseArgs({ allowPositionals: true, options: { keep: { type: 'string', multiple: true }, help: { type: 'boolean' } } });
  if (values.help) console.log('Usage: ascr run project-disposables [--keep PATH] ROOT\nRead-only allocated-size inventory of dependency and cache directories with recognizable manifests. Excludes symlinks, Git, runtime and worktree directories. Candidates require review for age, running users, tracked files and local modifications before deletion. No writes.');
  else {
    if (positionals.length !== 1) throw new Error('Supply exactly one scan root.');
    const result = inventoryProjectDisposables(positionals[0], values.keep || []);
    console.log(JSON.stringify(result));
    if (!result.complete) process.exitCode = 1;
  }
} catch (error) { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; }
