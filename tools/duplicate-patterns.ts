import { parseArgs } from 'node:util';
import { duplicatePatterns } from '../src/duplicate-patterns.ts';

const help = 'Usage: ascr run duplicate-patterns [--min-tokens N] [--min-lines N] [--min-string-chars N] [--min-occurrences N] [--max-results N] [--max-occurrences N] [--exclude GLOB] [--literals-only] ROOT\nRead-only audit for copied code/text blocks, raw Markdown/text prompt blocks, repeated static strings and style color values. Token blocks use jscpd@5.4.0 in strict mode; first use may populate npm cache. JSON includes file/line evidence, fingerprints and CSS-token equivalents. Dependencies, generated output, ignored/secret paths and oversized files are skipped; suspicious values are redacted. Repeated values are candidates, not automatic extraction or CI failures. Set a max option to 0 for unlimited output.';

try {
  const { values, positionals } = parseArgs({ allowPositionals: true, strict: true, options: {
    help: { type: 'boolean' },
    'min-tokens': { type: 'string' }, 'min-lines': { type: 'string' }, 'min-string-chars': { type: 'string' },
    'min-occurrences': { type: 'string' }, 'max-results': { type: 'string' }, 'max-occurrences': { type: 'string' }, exclude: { type: 'string', multiple: true },
    'literals-only': { type: 'boolean' },
  } });
  if (values.help) console.log(help);
  else {
    if (positionals.length !== 1) throw new Error('Supply exactly one scan root.');
    const number = (value: string | undefined) => value === undefined ? undefined : Number(value);
    console.log(JSON.stringify(duplicatePatterns(positionals[0], {
      minTokens: number(values['min-tokens']), minLines: number(values['min-lines']), minStringChars: number(values['min-string-chars']),
      minOccurrences: number(values['min-occurrences']), maxResults: number(values['max-results']), maxOccurrences: number(values['max-occurrences']), exclude: values.exclude, literalsOnly: values['literals-only'],
    }), null, 2));
  }
} catch (error) { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; }
