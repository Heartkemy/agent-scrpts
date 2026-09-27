import { readFileSync } from 'node:fs';
import { textReferences } from '../src/text-references.ts';
if (process.argv[2] === '--help') {
  console.log('ascr run text-references request.json\nInput: {files: string[], needles: string[]}. Paths resolve from cwd. Exact text matches with file/line; absence is not proof of unused code. No model or writes.');
} else {
  try {
    const input = JSON.parse(readFileSync(process.argv[2] || 0, 'utf8'));
    if (!Array.isArray(input.files) || !input.files.every((file: unknown) => typeof file === 'string') || !Array.isArray(input.needles)) throw new Error('Expected files and needles arrays.');
    console.log(JSON.stringify(textReferences(input.files, input.needles)));
  } catch (error) {
    console.error(JSON.stringify({error: error instanceof Error ? error.message : String(error)}));
    process.exitCode = 1;
  }
}
