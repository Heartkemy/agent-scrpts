import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyJsonl } from '../src/classify-jsonl.ts';

const template = { questions: { relevant: { type: 'noul', instructions: 'Is this relevant?' } }, model: 'fake' };
const result = (status = 'ok') => ({ status, answers: { relevant: { type: 'noul', noul: 0.5 } }, meta: { evidence: 'preserved' } });

test('sequential calls preserve full state, stable IDs and review results', async () => {
  const states = ['x'.repeat(100_000), { text: 'second' }, null];
  const seen: unknown[] = [], output: unknown[] = [];
  let active = 0;
  const exitCode = await classifyJsonl(template, states.map((state, id) => JSON.stringify({ id: String(id), state })).join('\r\n') + '\n', value => output.push(value), async req => {
    assert.equal(++active, 1);
    await new Promise(resolve => setImmediate(resolve));
    seen.push(req.state);
    assert.equal(req.model, 'fake');
    active--;
    return result(seen.length === 2 ? 'review' : 'ok');
  });
  assert.equal(exitCode, 3);
  assert.deepEqual(seen, states);
  assert.deepEqual(output, [0, 1, 2].map(id => ({ ...result(id === 1 ? 'review' : 'ok'), id: String(id) })));
  assert.equal(await classifyJsonl(template, '{"id":"only","state":null}', () => {}, async () => result()), 0);
});

test('invalid rows, duplicate IDs and invalid templates fail before any classification', async () => {
  const good = '{"id":"first","state":"whole text"}';
  const invalid = ['\n', 'bad JSON', '[]', '{}', '{"id":"x"}', '{"id":"","state":null}', '{"id":" x ","state":null}', '{"id":1,"state":null}', '{"id":"x","state":null,"extra":true}', '{"id":"x","state":1e999}', good];
  let calls = 0;
  for (const row of invalid) await assert.rejects(classifyJsonl(template, good + '\n' + row, () => {}, async () => { calls++; return result(); }));
  for (const value of [null, [], { ...template, state: 'forbidden' }, { ...template, extra: true }]) {
    await assert.rejects(classifyJsonl(value, good, () => {}, async () => { calls++; return result(); }));
  }
  await assert.rejects(classifyJsonl(template, '', () => {}, async () => { calls++; return result(); }));
  assert.equal(calls, 0);
});

test('fatal classifier errors stop the batch, and malformed output is rejected', async () => {
  const rows = ['first', 'second', 'third'].map(id => JSON.stringify({ id, state: id })).join('\n');
  const output: unknown[] = [];
  let calls = 0;
  await assert.rejects(classifyJsonl(template, rows, value => output.push(value), async () => {
    if (++calls === 2) throw new Error('token budget exceeded');
    return result();
  }), /ID second: token budget exceeded/);
  assert.equal(calls, 2);
  assert.deepEqual(output, [{ ...result(), id: 'first' }]);
  for (const value of [null, result('unexpected'), { status: 'ok', answers: {} }]) {
    await assert.rejects(classifyJsonl(template, rows, () => assert.fail('Invalid result emitted'), async () => value));
  }
});
