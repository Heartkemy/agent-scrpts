import { existsSync, mkdirSync, unlinkSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { atomicWrite, run } from './support.ts';
import { AppError } from './protocol.ts';
import type { Config } from './protocol.ts';
export const LABEL = 'local.agent-scrpts';
export const plistPath = () => join(homedir(), 'Library', 'LaunchAgents', `${LABEL}.plist`);
const xml = (s: string) => s.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&apos;');
export function installService(config: Config, configPath: string): void {
  if (process.platform !== 'darwin') throw new AppError('MAC_ONLY', 'LaunchAgent installation requires macOS.');
  const logDir = join(config.stateDir, 'logs'); mkdirSync(logDir, { recursive: true, mode: 0o700 });
  for (const f of ['service.out.log', 'service.err.log']) if (!existsSync(join(logDir, f))) atomicWrite(join(logDir, f), '');
  const path = plistPath();
  if (existsSync(path) && !readFileSync(path, 'utf8').includes('agent-scrpts-managed')) throw new AppError('FILE_CONFLICT', 'An unmanaged LaunchAgent already uses the requested filename.');
  const args = [process.execPath, '--experimental-strip-types', '--disable-warning=ExperimentalWarning', join(config.root, 'src', 'server.ts')];
  const text = `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<!-- agent-scrpts-managed -->\n<plist version="1.0"><dict>
<key>Label</key><string>${LABEL}</string>
<key>ProgramArguments</key><array>${args.map(a => `<string>${xml(a)}</string>`).join('')}</array>
<key>WorkingDirectory</key><string>${xml(config.root)}</string>
<key>EnvironmentVariables</key><dict><key>ASCR_CONFIG</key><string>${xml(configPath)}</string><key>PATH</key><string>${xml(process.env.PATH ?? '/usr/bin:/bin')}</string></dict>
<key>RunAtLoad</key><true/><key>KeepAlive</key><true/><key>ThrottleInterval</key><integer>10</integer>
<key>ProcessType</key><string>Background</string>
<key>StandardOutPath</key><string>${xml(join(logDir, 'service.out.log'))}</string>
<key>StandardErrorPath</key><string>${xml(join(logDir, 'service.err.log'))}</string>
</dict></plist>\n`;
  atomicWrite(path, text);
  run('/usr/bin/plutil', ['-lint', path]);
}
export function service(action: string): any {
  if (process.platform !== 'darwin') throw new AppError('MAC_ONLY', 'LaunchAgent management requires macOS.');
  const domain = `gui/${process.getuid!()}`, target = `${domain}/${LABEL}`, path = plistPath();
  if (action === 'status') return { installed: existsSync(path), launchctl: run('/bin/launchctl', ['print', target], { allowFailure: true }) || 'not loaded' };
  if (action === 'stop' || action === 'uninstall' || action === 'restart') run('/bin/launchctl', ['bootout', target], { allowFailure: true });
  if (action === 'uninstall') { if (existsSync(path)) unlinkSync(path); return { status: 'startup-removed', repositoryPreserved: true }; }
  if (action === 'stop') return { status: 'stopped' };
  if (!['start', 'restart'].includes(action)) throw new AppError('USAGE', 'Use service start|stop|restart|status|uninstall.');
  if (!existsSync(path)) throw new AppError('NOT_INSTALLED', 'No managed LaunchAgent exists. Rerun bootstrap.ts.');
  if (!run('/bin/launchctl', ['print', target], { allowFailure: true })) run('/bin/launchctl', ['bootstrap', domain, path]);
  run('/bin/launchctl', ['kickstart', '-k', target]);
  return { status: 'started' };
}
