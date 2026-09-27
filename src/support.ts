import { readFileSync, writeFileSync, mkdirSync, existsSync, renameSync, chmodSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { AppError, object } from './protocol.ts';
import type { Config } from './protocol.ts';
export const DEFAULT_CONFIG = join(homedir(), '.config', 'agent-scrpts', 'config.json');
export function readConfig(path = process.env.ASCR_CONFIG || DEFAULT_CONFIG): Config {
  if (!existsSync(path)) throw new AppError('NOT_INSTALLED', 'Run bootstrap.ts before using the installed service.');
  const config = JSON.parse(readFileSync(path, 'utf8')) as Config;
  if (config.version !== 1 || config.host !== '127.0.0.1' || !Number.isInteger(config.port) || config.port < 1024 || config.port > 65535 || !Array.isArray(config.models)) throw new AppError('BAD_CONFIG', 'Invalid local service configuration.');
  return config;
}
export function atomicWrite(path: string, content: string, mode = 0o600): void {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const tmp = `${path}.${process.pid}.${randomBytes(4).toString('hex')}.tmp`;
  writeFileSync(tmp, content, { mode }); renameSync(tmp, path); chmodSync(path, mode);
}
export function run(command: string, args: string[], options: { cwd?: string; inherit?: boolean; env?: NodeJS.ProcessEnv; allowFailure?: boolean } = {}): string {
  const r = spawnSync(command, args, { cwd: options.cwd, env: options.env ?? process.env, encoding: 'utf8', stdio: options.inherit ? 'inherit' : 'pipe', maxBuffer: 8 * 1024 * 1024 });
  if (r.error || r.status !== 0) {
    if (options.allowFailure) return '';
    throw new AppError('COMMAND_FAILED', `${command} ${args.slice(0, 3).join(' ')} failed: ${r.error?.message ?? r.stderr ?? `exit ${r.status}`}`, 500);
  }
  return (r.stdout ?? '').trim();
}
export function testFiles(root: string): string[] { return readdirSync(join(root, 'tests')).filter(f => f.endsWith('.test.ts')).sort().map(f => join(root, 'tests', f)); }
export function testRepository(root: string): void {
  const env = { ...process.env }; delete env.NODE_TEST_CONTEXT;
  run(process.execPath, ['--experimental-strip-types', '--disable-warning=ExperimentalWarning', '--test', ...testFiles(root)], { cwd: root, inherit: true, env });
}
export function errorObject(e: unknown): Record<string, unknown> {
  return e instanceof AppError ? { code: e.code, message: e.message, ...(e.details === undefined ? {} : { details: e.details }) } : { code: 'INTERNAL_ERROR', message: e instanceof Error ? e.message : 'Unexpected failure.' };
}
export async function api(path: string, body?: unknown, config = readConfig(), timeoutMs?: number): Promise<any> {
  const token = readFileSync(config.tokenFile, 'utf8').trim();
  const res = await fetch(`http://${config.host}:${config.port}${path}`, {
    method: body === undefined ? 'GET' : 'POST', redirect: 'error',
    headers: { Authorization: `Bearer ${token}`, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
    body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(timeoutMs ?? config.requestTimeoutMs + 5000),
  });
  const json = await res.json();
  if (!res.ok) throw new AppError(object(json.error) ? json.error.code : 'HTTP_ERROR', object(json.error) ? json.error.message : `HTTP ${res.status}`, res.status, json.error?.details);
  return json;
}
