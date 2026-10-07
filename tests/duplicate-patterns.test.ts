import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { findDuplicateLiterals, JSCPD_VERSION, jscpdCommand, normalizeJscpdReport } from '../src/duplicate-patterns.ts';
import { test } from 'node:test';

test('groups static strings and color values with locations, token hints and exclusions', () => {
  const root = mkdtempSync(join(tmpdir(), 'duplicate-patterns-'));
  try {
    const prompt = 'A long static prompt that should have one shared owner.';
    const secret = 'zQ4uP9bX2mR7kL5nC8vD1sF6hJ3wE0tY4aG7qN2rU5iO8pK';
    writeFileSync(join(root, 'second.ts'), `const prompt = "${prompt}";\nconst key = "${secret}";\n`);
    writeFileSync(join(root, 'first.ts'), `const prompt = "${prompt}";\nconst key = "${secret}";\n`);
    mkdirSync(join(root, 'ignored'));
    writeFileSync(join(root, 'ignored', 'third.ts'), `const prompt = "${prompt}";\n`);
    mkdirSync(join(root, 'node_modules'));
    writeFileSync(join(root, 'node_modules', 'ignored.ts'), `const prompt = "${prompt}";\n`);
    mkdirSync(join(root, '.runtime'));
    writeFileSync(join(root, '.runtime', 'ignored.ts'), `const prompt = "${prompt}";\n`);
    mkdirSync(join(root, '.next-browser'));
    writeFileSync(join(root, '.next-browser', 'ignored.ts'), `const prompt = "${prompt}";\n`);
    mkdirSync(join(root, 'out'));
    writeFileSync(join(root, 'out', 'ignored.ts'), `const prompt = "${prompt}";\n`);
    mkdirSync(join(root, '.worktrees'));
    writeFileSync(join(root, '.worktrees', 'ignored.ts'), `const prompt = "${prompt}";\n`);
    writeFileSync(join(root, 'secrets.json'), `{"token":"${secret}"}`);
    writeFileSync(join(root, 'oversized.txt'), 'x'.repeat(1_000_001));
    writeFileSync(join(root, 'palette.css'), ':root { --color-ink: #fff2df; }\n.one { color: #fff2df; }\n');
    writeFileSync(join(root, 'other.css'), '.two { color: #fff2df; }\n');
    writeFileSync(join(root, 'notes.md'), 'Documentation can mention #fff2df without becoming a style candidate.\n');
    const rawPrompt = 'Use the shared policy text exactly.\nKeep its owner in one file.\nDo not copy it into every workflow.';
    writeFileSync(join(root, 'first.txt'), `${rawPrompt}\n`);
    writeFileSync(join(root, 'second.txt'), `${rawPrompt}\n`);

    const report = findDuplicateLiterals(root, { minStringChars: 20, maxOccurrences: 1, exclude: ['**/ignored/**'] });
    const string = report.candidates.find(candidate => candidate.kind === 'string' && !candidate.redacted);
    const text = report.candidates.find(candidate => candidate.kind === 'text-block');
    const color = report.candidates.find(candidate => candidate.kind === 'color');
    assert.deepEqual(string?.occurrences.map(({ file, line, column }) => ({ file, line, column })), [
      { file: 'first.ts', line: 1, column: 16 },
    ]);
    assert.equal(string?.occurrenceCount, 2);
    assert.equal(string?.occurrencesTruncated, true);
    assert.equal(text?.occurrenceCount, 2);
    assert.deepEqual(text?.occurrences.map(({ file, line, endLine }) => ({ file, line, endLine })), [{ file: 'first.txt', line: 1, endLine: 3 }]);
    assert.equal(report.candidates.find(candidate => candidate.redacted)?.value, '[redacted string]');
    assert.equal(color?.token, '--color-ink');
    assert.equal(color?.directOccurrences, 2);
    assert.equal(color?.occurrences.length, 1);
    assert.equal(color?.occurrenceCount, 3);
    assert.equal(report.filesScanned, 7);
    assert.equal(report.skippedOversizedFiles, 1);
    assert.equal(report.gitignoreApplied, false);
    assert.equal(report.complete, true);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('pins strict jscpd invocation and accepts a zero result limit', () => {
  const invocation = jscpdCommand('/tmp/target', '/tmp/output', { minTokens: 12, minLines: 4, maxResults: 0, exclude: ['**/fixtures/**'] });
  assert.equal(invocation.command, 'npm');
  assert.equal(invocation.cwd, '/tmp/target');
  assert.deepEqual(invocation.args.slice(0, 9), ['exec', '--yes', `--package=jscpd@${JSCPD_VERSION}`, '--', 'jscpd', '--config', '/tmp/output/ascr-jscpd.json', '--mode', 'strict']);
  assert.ok(invocation.args.some(argument => argument.includes('**/fixtures/**')));
  assert.ok(invocation.args.includes('--fail-on-empty'));
  assert.equal(invocation.args.at(-1), '.');
});

test('groups jscpd pairs into one pattern with all locations', () => {
  const report = normalizeJscpdReport('/repo', { duplicates: [
    { fragment: 'const shared = 1;', kind: 'exact', format: 'typescript', lines: 1, tokens: 5, firstFile: { name: 'a.ts', start: 1, end: 1 }, secondFile: { name: 'b.ts', start: 2, end: 2 } },
    { fragment: 'const shared = 1;', kind: 'exact', format: 'typescript', lines: 1, tokens: 5, firstFile: { name: 'a.ts', start: 1, end: 1 }, secondFile: { name: 'c.ts', start: 3, end: 3 } },
  ] }, { maxOccurrences: 2 });
  assert.equal(report.candidateCount, 1);
  assert.equal(report.candidates[0].occurrenceCount, 3);
  assert.equal(report.candidates[0].occurrencesTruncated, true);
  assert.deepEqual(report.candidates[0].occurrences.map(({ file, startLine }) => ({ file, startLine })), [
    { file: 'a.ts', startLine: 1 }, { file: 'b.ts', startLine: 2 },
  ]);
});
