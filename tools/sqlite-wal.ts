import { walOverlay } from '../src/sqlite-wal.ts';
try {
  const args = process.argv.slice(2);
  if (args.includes('--help')) {
    console.log('Usage: ascr run sqlite-wal <wal> [<base-db> <NEW-candidate-db>]\nValidates WAL checksums; optional separate forensic overlay includes uncommitted pages. Preserve originals; validate candidate integrity and extracted records independently. Never apply directly to a live database.');
  } else {
    if (args.length !== 1 && args.length !== 3) throw new Error('Expected WAL, optionally base DB and NEW candidate output; use --help');
    console.log(JSON.stringify(walOverlay(args[0], args[1], args[2])));
  }
} catch (e) { console.error(JSON.stringify({error:e instanceof Error ? e.message : String(e)})); process.exitCode=1; }
