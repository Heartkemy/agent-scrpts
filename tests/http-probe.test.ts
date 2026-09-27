import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { probeHttp } from '../src/http-probe.ts';

test('HTTP probe handles redirects, status, user agents, binary bodies and bounds', async t => {
  const server = createServer((req, res) => {
    if (req.url === '/redirect') { res.writeHead(302, { Location: '/text' }); res.end(); return; }
    if (req.url === '/slow') return;
    res.setHeader('Set-Cookie', 'private=secret');
    if (req.url === '/binary') { res.setHeader('Content-Type', 'image/jpeg'); res.end(Buffer.from([255, 216, 255])); return; }
    res.setHeader('Content-Type', 'text/plain');
    if (req.url === '/missing') res.statusCode = 404;
    res.end(req.headers['user-agent']);
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => { server.closeAllConnections(); server.close(); });
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  const base = `http://127.0.0.1:${address.port}`;
  const result = await probeHttp(base + '/redirect', { userAgent: 'Twitterbot/1.0', bodyChars: 7 });
  assert.equal(result.redirected, true);
  assert.equal(result.finalUrl, base + '/text');
  assert.equal(result.body, 'Twitter');
  assert.equal(result.bytes, 14);
  assert.equal(result.headers['set-cookie'], undefined);
  assert.equal((await probeHttp(base + '/missing')).ok, false);
  assert.equal((await probeHttp(base + '/binary', { bodyChars: 100 })).body, undefined);
  await assert.rejects(probeHttp(base + '/text', { maxBytes: 1 }), /exceeds/);
  await assert.rejects(probeHttp(base + '/slow', { timeoutMs: 30 }), /abort|timeout/i);
  await assert.rejects(probeHttp('file:///etc/passwd'), /HTTP/);
  await assert.rejects(probeHttp('https://user:secret@example.com'), /credentials/);
});
