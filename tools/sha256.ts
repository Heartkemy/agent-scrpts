import { createReadStream } from 'node:fs';
import { createHash } from 'node:crypto';
try {
  const file = process.argv[2]; if (!file) throw new Error('Usage: ascr run sha256 <file>');
  const sha = createHash('sha256'); for await (const chunk of createReadStream(file)) sha.update(chunk);
  process.stdout.write(JSON.stringify({ file, sha256: sha.digest('hex') }) + '\n');
} catch (e) { process.stderr.write(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }) + '\n'); process.exitCode = 1; }
