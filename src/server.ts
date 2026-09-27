import { createServer } from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { AppError, validateRequest } from './protocol.ts';
import type { Config } from './protocol.ts';
import type { Backend } from './workers.ts';
import { Workers } from './workers.ts';
import { Router, SerialQueue } from './router.ts';
import { readConfig, errorObject } from './support.ts';
function respond(res: ServerResponse, status: number, value: unknown): void {
  if (res.destroyed || res.writableEnded) return;
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  res.end(JSON.stringify(value));
}
export function authorized(req: IncomingMessage, token: string, port: number): boolean {
  if (req.headers.origin !== undefined) return false; // No browser/cross-origin access or DNS rebinding.
  if (![`127.0.0.1:${port}`, `localhost:${port}`].includes(req.headers.host ?? '')) return false;
  const supplied = req.headers.authorization ?? '';
  const wanted = `Bearer ${token}`;
  return Buffer.byteLength(supplied) === Buffer.byteLength(wanted) && timingSafeEqual(Buffer.from(supplied), Buffer.from(wanted));
}
async function body(req: IncomingMessage, limit: number): Promise<unknown> {
  if (!(req.headers['content-type'] ?? '').toLowerCase().startsWith('application/json')) throw new AppError('CONTENT_TYPE', 'Use application/json.', 415);
  let size = 0; const buffers: Buffer[] = [];
  for await (const data of req) {
    const b = Buffer.from(data); size += b.length;
    if (size > limit) throw new AppError('BODY_TOO_LARGE', 'Request exceeds the service byte limit.', 413);
    buffers.push(b);
  }
  try { return JSON.parse(Buffer.concat(buffers).toString('utf8')); }
  catch { throw new AppError('INVALID_JSON', 'Malformed JSON request.', 400); }
}
export function createApp(config: Config, backend: Backend = new Workers(config)) {
  const token = readFileSync(config.tokenFile, 'utf8').trim();
  if (token.length < 32) throw new AppError('BAD_TOKEN', 'Service token is missing or too short.');
  const router = new Router(config, backend), queue = new SerialQueue(config.maxQueue);
  const server = createServer(async (req, res) => {
    try {
      // port=0 is supported for tests; production binds a fixed config port.
      const actual = server.address(); const port = typeof actual === 'object' && actual ? actual.port : config.port;
      if (!authorized(req, token, port)) { respond(res, 401, { error: { code: 'UNAUTHORIZED', message: 'Local bearer authentication required; browser origins are refused.' } }); return; }
      const path = req.url?.split('?')[0];
      if (req.method === 'GET' && path === '/health') { respond(res, 200, { service: 'agent-scrpts', version: 1, status: 'ready', inference: 'lazy', queue: queue.pending, installed: config.models.filter(m => m.enabled).map(m => m.id) }); return; }
      if (req.method === 'GET' && path === '/v1/models') {
        respond(res, 200, { data: config.models.map(({ path, ...m }) => m), router: config.router, questionTypes: ['choice', 'score', 'noul'], limits: { questions: 16, bodyBytes: config.maxBodyBytes, requestTimeoutMs: config.requestTimeoutMs }, vision: false }); return;
      }
      if (req.method !== 'POST' || !['/v1/systemone', '/v1/route'].includes(path ?? '')) { respond(res, 404, { error: { code: 'NOT_FOUND', message: 'Unknown endpoint.' } }); return; }
      const deadline = Date.now() + config.requestTimeoutMs;
      const request = validateRequest(await body(req, config.maxBodyBytes));
      const result = await queue.run(async () => {
        if (res.destroyed) throw new AppError('DISCONNECTED', 'Client disconnected before inference started.', 499);
        if (path === '/v1/route') return (await router.choose(request, deadline)).routing;
        return router.classify(request, deadline);
      }, deadline);
      respond(res, 200, result);
    } catch (e) { respond(res, e instanceof AppError ? e.status : 500, { error: errorObject(e) }); }
  });
  server.requestTimeout = 30_000; server.headersTimeout = 10_000; server.keepAliveTimeout = 5_000;
  server.on('clientError', (_, socket) => { if (socket.writable) socket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n'); });
  server.on('close', () => backend.close());
  return { server, router, backend };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const config = readConfig(), { server, backend } = createApp(config);
  server.listen(config.port, config.host, () => process.stderr.write(`agent-scrpts listening on ${config.host}:${config.port}\n`));
  server.on('error', e => { process.stderr.write(JSON.stringify(errorObject(e)) + '\n'); process.exitCode = 1; backend.close(); });
  const stop = () => { backend.close(); server.close(() => process.exit(0)); setTimeout(() => process.exit(0), 1500).unref(); };
  process.on('SIGTERM', stop); process.on('SIGINT', stop);
}
