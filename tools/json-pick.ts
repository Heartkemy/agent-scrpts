import { readFileSync } from 'node:fs';
const pointer = process.argv[2] ?? '';
try {
  let value = JSON.parse(readFileSync(0, 'utf8'));
  if (pointer !== '' && !pointer.startsWith('/')) throw new Error('Use an RFC 6901 JSON Pointer, e.g. /items/0/title.');
  if (pointer) for (const raw of pointer.slice(1).split('/')) {
    if (/~(?:[^01]|$)/.test(raw)) throw new Error('Invalid JSON Pointer escape.');
    const key = raw.replaceAll('~1', '/').replaceAll('~0', '~');
    if (value === null || typeof value !== 'object' || !Object.hasOwn(value, key)) throw new Error('JSON Pointer does not exist.');
    value = value[key];
  }
  process.stdout.write(JSON.stringify(value) + '\n');
} catch (e) { process.stderr.write(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }) + '\n'); process.exitCode = 1; }
