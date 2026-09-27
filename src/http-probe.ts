/** Inspect an unauthenticated HTTP GET. This does not reproduce a remote crawler's IP or cache. */
export async function probeHttp(input: string, options: {
  userAgent?: string; timeoutMs?: number; maxBytes?: number; bodyChars?: number;
} = {}) {
  const url = new URL(input);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
    throw new Error('Use an HTTP(S) URL without embedded credentials.');
  }
  const timeoutMs = options.timeoutMs ?? 20_000;
  const maxBytes = options.maxBytes ?? 5_000_000;
  const bodyChars = options.bodyChars ?? 0;
  if (![timeoutMs, maxBytes, bodyChars].every(Number.isSafeInteger) ||
      timeoutMs < 1 || maxBytes < 1 || bodyChars < 0) {
    throw new Error('Timeout and byte limit must be positive integers; body length must be nonnegative.');
  }
  const start = performance.now();
  const response = await fetch(url, {
    headers: options.userAgent ? { 'User-Agent': options.userAgent } : {},
    signal: AbortSignal.timeout(timeoutMs),
  });
  const firstByteMs = Math.round(performance.now() - start);
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  if (response.body) {
    for await (const chunk of response.body) {
      bytes += chunk.byteLength;
      if (bytes > maxBytes) throw new Error(`Response exceeds ${maxBytes} bytes.`);
      chunks.push(chunk);
    }
  }
  const body = Buffer.concat(chunks);
  const headerNames = ['content-type', 'content-length', 'content-encoding', 'cache-control',
    'vary', 'age', 'server', 'cf-cache-status', 'cf-mitigated', 'cf-ray', 'x-robots-tag'];
  const headers = Object.fromEntries(headerNames.flatMap(name => {
    const value = response.headers.get(name);
    return value === null ? [] : [[name, value]];
  }));
  const type = headers['content-type'] ?? '';
  const textual = /^(text\/|application\/(json|xml|[^;]+\+json|[^;]+\+xml))/.test(type);
  return {
    url: url.href, finalUrl: response.url, status: response.status,
    ok: response.ok, redirected: response.redirected, headers, bytes,
    firstByteMs, totalMs: Math.round(performance.now() - start),
    ...(bodyChars && textual ? { body: body.toString('utf8').slice(0, bodyChars) } : {}),
  };
}
