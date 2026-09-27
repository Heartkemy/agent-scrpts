import { readFileSync } from 'node:fs';

export type TextReference = { file: string; line: number };

/** Exact source-text evidence only. No match is a candidate for investigation, not proof of dead code. */
export function textReferences(files: string[], needles: string[]): Record<string, TextReference[]> {
  if (needles.some(needle => typeof needle !== 'string' || !needle.length)) throw new Error('Needles must be nonempty strings.');
  const result: Record<string, TextReference[]> = Object.fromEntries(needles.map(needle => [needle, []]));
  for (const file of [...new Set(files)]) {
    const text = readFileSync(file, 'utf8');
    for (const needle of Object.keys(result)) {
      let from = 0;
      while (true) {
        const index = text.indexOf(needle, from);
        if (index === -1) break;
        const line = text.slice(0, index).split('\n').length;
        if (result[needle].at(-1)?.file !== file || result[needle].at(-1)?.line !== line) result[needle].push({ file, line });
        from = index + needle.length;
      }
    }
  }
  return result;
}
