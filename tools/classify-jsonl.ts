import { readFileSync } from 'node:fs';
import { classifyJsonl } from '../src/classify-jsonl.ts';

const help = 'ascr run classify-jsonl template.json rows.jsonl\nTemplate: classification request without state. Each JSONL row: {id: unique nonempty string, state: JSON}.\nValidates the whole batch, then classifies sequentially without truncation. Writes {id,...response} JSONL to stdout.\nExit 0: all ok; 3: one or more review results (preserved); 1: fatal error (earlier results may already be written).\nReview requires independent judgment or better evidence. No result authorizes external actions.';
try {
  const args = process.argv.slice(2);
  if (args.length === 1 && args[0] === '--help') console.log(help);
  else {
    if (args.length !== 2) throw new Error(help);
    process.exitCode = await classifyJsonl(
      JSON.parse(readFileSync(args[0], 'utf8')), readFileSync(args[1], 'utf8'),
      result => { process.stdout.write(JSON.stringify(result) + '\n'); },
    );
  }
} catch (error) {
  console.error(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }));
  process.exitCode = 1;
}
