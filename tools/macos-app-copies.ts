import { parseArgs } from 'node:util';
import { inventoryAppCopies } from '../src/macos-app-copies.ts';

try {
  const { values, positionals } = parseArgs({ allowPositionals: true, options: {
    'bundle-id': { type: 'string', multiple: true }, keep: { type: 'string', multiple: true }, help: { type: 'boolean' },
  } });
  if (values.help) {
    console.log('Usage: ascr run macos-app-copies --bundle-id ID [--bundle-id ID] [--keep APP] ROOT...\nRead-only macOS app inventory by exact bundle ID, with allocated bytes. Does not follow symlinks or count nested helpers; skips Git, dependency, target and database directories. Review errors before cleanup. Performs no deletion.');
  } else {
    const result = await inventoryAppCopies(positionals, values['bundle-id'] || [], values.keep || []);
    console.log(JSON.stringify(result));
    if (!result.complete) process.exitCode = 1;
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1;
}
