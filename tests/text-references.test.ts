import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { textReferences } from '../src/text-references.ts';
test('indexes exact multiline text, preserves special keys and reports missing candidates', () => {
  const dir = mkdtempSync(join(tmpdir(), 'text-refs-'));
  try {
    const file = join(dir, 'source.ts');
    writeFileSync(file, 'hello hello\n__proto__\nhello\nworld');
    assert.deepEqual(textReferences([file, file], ['hello', 'hello\nworld', '__proto__', 'absent']), {
      hello: [{file, line: 1}, {file, line: 3}],
      'hello\nworld': [{file, line: 3}],
      ['__proto__']: [{file, line: 2}],
      absent: [],
    });
    assert.throws(() => textReferences([file], ['']), /nonempty/);
    assert.throws(() => textReferences([join(dir, 'missing')], ['hello']));
  } finally { rmSync(dir, {recursive: true, force: true}); }
});
