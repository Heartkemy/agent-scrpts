#!/usr/bin/env node
import { readFileSync, realpathSync, existsSync } from 'node:fs';
import { resolve, join, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { spawnSync } from 'node:child_process';
import { api, readConfig, errorObject, testRepository, run } from './support.ts';
import { AppError } from './protocol.ts';
import { service } from './service.ts';
import { newWorktree, integrate } from './git-tools.ts';
const output = (v: unknown) => process.stdout.write(JSON.stringify(v, null, 2) + '\n');
const sourceRoot = () => resolve(fileURLToPath(new URL('..', import.meta.url)));
const HELP = `ascr — shared agent scripts, deterministic utilities and local typed decisions

  ascr decide --file request.json       Classify (use --file - for stdin)
  ascr route --file request.json        Inspect classifier routing without the final decision
  ascr models                          Installed models and effective context limits
  ascr doctor                          Local configuration and service health
  ascr self-test                       Real inference + warm timings for installed models
  ascr service start|stop|restart|status|uninstall
  ascr tools                           Discover reusable deterministic tools
  ascr run <tool> [arguments...]        Run a registered TypeScript tool
  ascr test                            Run weight-free tests
  ascr worktree new <slug>              Fetch main and create your branch/worktree
  ascr worktree integrate <path>        Test merged work, push main, clean up your worktree

Request: {state, questions:{id:{type,instructions,criteria?}}, model?:"auto"|id,
          task?, language?, policy?:{minProbability,minMargin}, cache?:false}
Types: choice (labels/descriptions), score (ordered rubric), noul (P(true)).
No text generation, image input, MCP, or automatic browser/external actions.
Exit codes: 0 successful; 1 error; 3 classification needs review.
The service URL/token path are in ~/.config/agent-scrpts/config.json.
`;
try {
  const [command = 'help', ...rest] = process.argv.slice(2);
  if (['help', '--help', '-h'].includes(command)) process.stdout.write(HELP);
  else if (command === 'tools' || command === 'run') {
    const tools = JSON.parse(readFileSync(join(sourceRoot(), 'tools', 'index.json'), 'utf8'));
    if (command === 'tools') output(tools);
    else {
      const tool = tools.find((t: any) => t.name === rest[0]);
      if (!tool) throw new AppError('UNKNOWN_TOOL', 'Unknown tool. Run ascr tools.');
      const base = realpathSync(join(sourceRoot(), 'tools')), entry = realpathSync(resolve(base, tool.entry));
      if (!entry.startsWith(base + sep) || !entry.endsWith('.ts')) throw new AppError('TOOL_SCOPE', 'Tool entry must be a TypeScript file inside tools/.');
      const result = spawnSync(process.execPath, ['--experimental-strip-types', '--disable-warning=ExperimentalWarning', entry, ...rest.slice(1)], { stdio: 'inherit' });
      if (result.error) throw result.error; process.exitCode = result.status ?? 1;
    }
  }
  else if (command === 'test') {
    let target = sourceRoot();
    const cwdRoot = run('git', ['rev-parse', '--show-toplevel'], { allowFailure: true });
    if (cwdRoot) {
      const common = (path: string) => realpathSync(resolve(path, run('git', ['-C', path, 'rev-parse', '--git-common-dir'])));
      if (common(cwdRoot) === common(target)) target = cwdRoot;
    }
    testRepository(target);
  }
  else if (command === 'worktree') {
    if (rest[0] === 'new' && rest[1]) output(newWorktree(sourceRoot(), rest[1]));
    else if (rest[0] === 'integrate' && rest[1]) output(integrate(sourceRoot(), rest[1]));
    else throw new AppError('USAGE', 'Use worktree new <slug> or worktree integrate <path>.');
  }
  else {
    const config = readConfig();
    if (command === 'decide' || command === 'classify' || command === 'route') {
      const { values } = parseArgs({ args: rest, options: { file: { type: 'string', short: 'f' }, model: { type: 'string' }, 'no-cache': { type: 'boolean' } }, strict: true });
      if (!values.file && process.stdin.isTTY) throw new AppError('USAGE', 'Provide --file request.json or pipe a JSON request to stdin.');
      const req = JSON.parse(readFileSync(values.file && values.file !== '-' ? resolve(values.file) : 0, 'utf8'));
      if (values.model) req.model = values.model;
      if (values['no-cache']) req.cache = false;
      const answer = await api(command === 'route' ? '/v1/route' : '/v1/systemone', req, config);
      output(answer); if (answer.status === 'review') process.exitCode = 3;
    } else if (command === 'models') output(await api('/v1/models', undefined, config));
    else if (command === 'doctor') {
      let health: any; try { health = await api('/health', undefined, config, 3000); } catch (e) { health = { error: errorObject(e) }; process.exitCode = 1; }
      output({ root: config.root, endpoint: `http://${config.host}:${config.port}/v1/systemone`, tokenFile: config.tokenFile,
        python: Object.fromEntries(Object.entries(config.python).map(([k, p]) => [k, { path: p, exists: existsSync(p) }])),
        models: config.models.map(m => ({ id: m.id, enabled: m.enabled, filesPresent: existsSync(m.path), revision: m.revision, error: m.error })),
        health, omlx: 'Unmodified; this service uses separate native decision runtimes.' });
    } else if (command === 'self-test') {
      // Run through the service so tests share its serialization and do not fight its GPU workers.
      const { SMOKE } = await import('./smoke.ts'); const results: any[] = [];
      for (const model of config.models.filter(m => m.enabled)) {
        try {
          const first = await api('/v1/systemone', { ...SMOKE, model: model.id, cache: false }, config);
          const second = await api('/v1/systemone', { ...SMOKE, model: model.id, cache: false }, config);
          results.push({ model: model.id, operational: true, firstMs: first.meta.elapsedMs, secondMs: second.meta.elapsedMs, status: second.status,
            sanity: { billingSelected: second.answers.department.choice === 'billing', refundAboveHalf: second.answers.refund.noul > 0.5 } });
        } catch (e) { results.push({ model: model.id, operational: false, error: errorObject(e) }); process.exitCode = 1; }
      }
      output({ results, note: 'Functional sanity checks, not an accuracy or calibration benchmark.' });
    } else if (command === 'service') output(service(rest[0] ?? 'status'));
    else throw new AppError('USAGE', `Unknown command: ${command}. Run ascr help.`);
  }
} catch (e) { process.stderr.write(JSON.stringify({ error: errorObject(e) }, null, 2) + '\n'); process.exitCode = 1; }
