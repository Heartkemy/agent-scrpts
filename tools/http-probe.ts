import { parseArgs } from 'node:util';
import { probeHttp } from '../src/http-probe.ts';

try {
  const { values, positionals } = parseArgs({ allowPositionals: true, options: {
    'user-agent': { type: 'string' }, 'timeout-ms': { type: 'string' },
    'max-bytes': { type: 'string' }, 'body-chars': { type: 'string' },
    help: { type: 'boolean' },
  } });
  if (values.help || !positionals.length) {
    process.stdout.write('Usage: ascr run http-probe [--user-agent NAME] [--timeout-ms 20000] [--max-bytes 5000000] [--body-chars 0] URL...\nUnauthenticated GETs; JSON lines, bounded body, safe response headers. A spoofed user agent is not evidence of the real crawler response.\n');
    if (!values.help) process.exitCode = 1;
  } else {
    for (const url of positionals) {
      try {
        const result = await probeHttp(url, {
          userAgent: values['user-agent'],
          timeoutMs: values['timeout-ms'] === undefined ? undefined : Number(values['timeout-ms']),
          maxBytes: values['max-bytes'] === undefined ? undefined : Number(values['max-bytes']),
          bodyChars: values['body-chars'] === undefined ? undefined : Number(values['body-chars']),
        });
        process.stdout.write(JSON.stringify(result) + '\n');
        if (!result.ok) process.exitCode = 1;
      } catch (error) {
        process.stderr.write(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }) + '\n');
        process.exitCode = 1;
      }
    }
  }
} catch (error) {
  process.stderr.write(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }) + '\n');
  process.exitCode = 1;
}
