import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { lstatSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { extname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { tmpdir } from 'node:os';

export const JSCPD_VERSION = '5.4.0';

const SKIP_DIRECTORIES = new Set(['.agent-scrpts-worktrees', '.cache', '.git', '.next', '.nuxt', '.pytest_cache', '.runtime', '.secrets', '.svelte-kit', '.turbo', '.venv', '.worktrees', '__pycache__', 'build', 'coverage', 'credentials', 'dist', 'graphify-out', 'node_modules', 'out', 'secrets', 'target', 'vendor', 'venv', 'worktrees']);
const SKIP_DIRECTORY_GLOBS = ['**/.next*/**', '**/.nuxt*/**', '**/.svelte-kit*/**', '**/.turbo*/**'];
const SKIP_FILES = new Set(['Cargo.lock', 'package-lock.json', 'pnpm-lock.yaml', 'yarn.lock']);
const SENSITIVE_EXTENSIONS = new Set(['.cer', '.crt', '.key', '.p12', '.pem', '.pfx']);
const SENSITIVE_GLOBS = ['**/.env*', '**/*.cer', '**/*.crt', '**/*.key', '**/*.p12', '**/*.pem', '**/*.pfx', '**/credentials/**', '**/credentials.*', '**/secrets/**', '**/secrets.*'];
const TEXT_EXTENSIONS = new Set(['.c', '.cc', '.cjs', '.cpp', '.cs', '.css', '.go', '.graphql', '.gql', '.h', '.hpp', '.html', '.java', '.js', '.json', '.jsx', '.kt', '.less', '.mjs', '.md', '.mdx', '.php', '.py', '.rb', '.rs', '.sass', '.scss', '.sh', '.svelte', '.swift', '.toml', '.ts', '.tsx', '.txt', '.vue', '.xml', '.yaml', '.yml']);
const STRING_EXTENSIONS = new Set(['.cjs', '.css', '.js', '.json', '.jsx', '.less', '.mjs', '.rs', '.sass', '.scss', '.ts', '.tsx', '.vue', '.yaml', '.yml']);
const TEXT_BLOCK_EXTENSIONS = new Set(['.md', '.mdx', '.txt']);
const COLOR_EXTENSIONS = new Set(['.cjs', '.css', '.html', '.js', '.jsx', '.less', '.mjs', '.sass', '.scss', '.svelte', '.ts', '.tsx', '.vue']);
const HEX_COLOR = /#(?:[\da-f]{8}|[\da-f]{6}|[\da-f]{4}|[\da-f]{3})(?![\da-f])/gi;
const CSS_TOKEN = /(--[\w-]+)\s*:\s*(#(?:[\da-f]{8}|[\da-f]{6}|[\da-f]{4}|[\da-f]{3}))(?![\da-f])/gi;

export type DuplicatePatternOptions = {
  minTokens?: number;
  minLines?: number;
  minStringChars?: number;
  minOccurrences?: number;
  maxResults?: number;
  maxOccurrences?: number;
  exclude?: string[];
  literalsOnly?: boolean;
};

type Options = Required<Omit<DuplicatePatternOptions, 'exclude' | 'literalsOnly'>> & Pick<DuplicatePatternOptions, 'exclude' | 'literalsOnly'>;
type FileText = { file: string; text: string; extension: string };
type Location = { file: string; line: number; column: number };
type LiteralKind = 'color' | 'string' | 'text-block';
type Occurrence = Location & { endLine?: number; tokenDefinition?: boolean };

export type LiteralCandidate = {
  kind: LiteralKind;
  fingerprint: string;
  value: string;
  chars: number;
  occurrences: Occurrence[];
  occurrenceCount: number;
  occurrencesTruncated: boolean;
  redacted?: true;
  directOccurrences?: number;
  token?: string;
  alphaSuffix?: string;
};

type LiteralReport = {
  filesScanned: number;
  candidates: LiteralCandidate[];
  candidateCount: number;
  truncated: boolean;
  errors: Array<{ file: string; error: string }>;
  skippedOversizedFiles: number;
  gitignoreApplied: boolean;
  complete: boolean;
};

type CloneCandidate = {
  kind: string;
  format: string;
  lines: number;
  tokens: number;
  fingerprint: string;
  excerpt: string;
  occurrences: Array<{ file: string; startLine: number; endLine: number }>;
  occurrenceCount: number;
  occurrencesTruncated: boolean;
  redacted?: true;
};

type CloneReport = {
  engine: { name: 'jscpd'; version: string; mode: 'strict' };
  candidates: CloneCandidate[];
  candidateCount: number;
  truncated: boolean;
};

const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const posix = (path: string) => path.split(sep).join('/');

function integer(value: number | undefined, fallback: number, name: string, allowZero = false) {
  const result = value ?? fallback;
  if (!Number.isSafeInteger(result) || result < (allowZero ? 0 : 1)) throw new Error(`${name} must be a ${allowZero ? 'nonnegative' : 'positive'} integer.`);
  return result;
}

function options(input: DuplicatePatternOptions = {}): Options {
  return {
    minTokens: integer(input.minTokens, 30, 'minTokens'),
    minLines: integer(input.minLines, 3, 'minLines'),
    minStringChars: integer(input.minStringChars, 40, 'minStringChars'),
    minOccurrences: integer(input.minOccurrences, 2, 'minOccurrences'),
    maxResults: integer(input.maxResults, 50, 'maxResults', true),
    maxOccurrences: integer(input.maxOccurrences, 20, 'maxOccurrences', true),
    exclude: input.exclude?.filter(value => typeof value === 'string' && value.length > 0) || [],
    literalsOnly: input.literalsOnly === true,
  };
}

function glob(pattern: string) {
  let expression = '^';
  for (let index = 0; index < pattern.length; index++) {
    const char = pattern[index];
    if (char === '*') {
      if (pattern[index + 1] === '*') {
        index++;
        if (pattern[index + 1] === '/') { index++; expression += '(?:.*/)?'; }
        else expression += '.*';
      } else expression += '[^/]*';
    } else if (char === '?') expression += '[^/]';
    else expression += char.replace(/[|\\{}()[\]^$+?.]/g, '\\$&');
  }
  return new RegExp(`${expression}$`);
}

function rootPath(root: string) {
  const resolved = realpathSync(resolve(root));
  if (!lstatSync(resolved).isDirectory()) throw new Error('Scan root must be a directory.');
  return resolved;
}

function sensitiveFile(file: string) {
  const name = file.split('/').at(-1) || file;
  return name === '.env' || name.startsWith('.env.') || SENSITIVE_EXTENSIONS.has(extname(name).toLowerCase()) || /(?:^|[._-])(credentials?|password|private|secrets?)(?:[._-]|$)/i.test(name);
}

function visibleFiles(root: string, files: FileText[]) {
  const input = files.map(file => file.file).join('\0');
  if (!input) return { files, gitignoreApplied: false };
  const result = spawnSync('git', ['-C', root, 'check-ignore', '--no-index', '-z', '--stdin'], { input: `${input}\0`, timeout: 10_000 });
  if (result.error || ![0, 1].includes(result.status ?? -1)) return { files, gitignoreApplied: false };
  const ignored = new Set(Buffer.from(result.stdout || []).toString('utf8').split('\0').filter(Boolean).map(posix));
  return { files: files.filter(file => !ignored.has(file.file)), gitignoreApplied: true };
}

function readableTextFiles(root: string, excludes: string[]) {
  const files: FileText[] = [];
  const errors: Array<{ file: string; error: string }> = [];
  let skippedOversizedFiles = 0;
  const excluded = excludes.map(glob);
  const skippedDirectory = SKIP_DIRECTORY_GLOBS.map(glob);
  const matchesExclude = (file: string) => excluded.some(pattern => pattern.test(file));
  const visit = (directory: string) => {
    let entries: ReturnType<typeof readdirSync>;
    try { entries = readdirSync(directory, { withFileTypes: true }); }
    catch (error) { errors.push({ file: posix(relative(root, directory)) || '.', error: error instanceof Error ? error.message : String(error) }); return; }
    for (const entry of entries) {
      const absolute = join(directory, entry.name);
      const file = posix(relative(root, absolute));
      if (entry.isSymbolicLink() || sensitiveFile(file) || matchesExclude(file) || matchesExclude(`${file}/`)) continue;
      if (entry.isDirectory()) {
        const git = lstatSync(join(absolute, '.git'), { throwIfNoEntry: false });
        if (!SKIP_DIRECTORIES.has(entry.name) && !git?.isFile() && !skippedDirectory.some(pattern => pattern.test(`${file}/`))) visit(absolute);
        continue;
      }
      const extension = extname(entry.name).toLowerCase();
      if (!entry.isFile() || SKIP_FILES.has(entry.name) || !TEXT_EXTENSIONS.has(extension)) continue;
      try {
        const stat = lstatSync(absolute);
        if (stat.size > 1_000_000) { skippedOversizedFiles++; continue; }
        const bytes = readFileSync(absolute);
        if (bytes.includes(0)) continue;
        files.push({ file, text: bytes.toString('utf8'), extension });
      } catch (error) { errors.push({ file, error: error instanceof Error ? error.message : String(error) }); }
    }
  };
  visit(root);
  const visible = visibleFiles(root, files.sort((left, right) => left.file.localeCompare(right.file)));
  return { ...visible, errors, skippedOversizedFiles };
}

function lineStarts(text: string) {
  const starts = [0];
  for (let index = text.indexOf('\n'); index !== -1; index = text.indexOf('\n', index + 1)) starts.push(index + 1);
  return starts;
}

function location(file: FileText, starts: number[], offset: number): Location {
  let low = 0, high = starts.length;
  while (low + 1 < high) {
    const middle = Math.floor((low + high) / 2);
    if (starts[middle] <= offset) low = middle; else high = middle;
  }
  return { file: file.file, line: low + 1, column: offset - starts[low] + 1 };
}

function excerpt(value: string) {
  const compact = value.replace(/\s+/g, ' ').trim();
  return compact.length > 200 ? `${compact.slice(0, 197)}...` : compact;
}

function entropy(value: string) {
  const counts = new Map<string, number>();
  for (const char of value) counts.set(char, (counts.get(char) || 0) + 1);
  return [...counts.values()].reduce((total, count) => { const probability = count / value.length; return total - probability * Math.log2(probability); }, 0);
}

function secretLike(value: string) {
  const compact = value.trim();
  return /-----BEGIN [A-Z ]*PRIVATE KEY-----|(?:api[_-]?key|authorization|bearer|credential|password|secret|token)\s*(?:=|:)|^(?:ghp_|github_pat_|sk-|xox[a-z]-|eyJ[a-z\d_-]+\.)/i.test(value)
    || (compact.length >= 32 && /^[a-z\d._+/-]+$/i.test(compact) && entropy(compact) >= 3.5);
}

function shown(value: string, label: string) {
  return secretLike(value) ? { value: `[redacted ${label}]`, redacted: true as const } : { value: excerpt(value) };
}

function add(grouped: Map<string, Array<{ value: string; occurrence: Occurrence }>>, kind: LiteralKind, value: string, occurrence: Occurrence) {
  const key = `${kind}\0${value}`;
  const group = grouped.get(key);
  if (group) group.push({ value, occurrence }); else grouped.set(key, [{ value, occurrence }]);
}

function stringLiterals(file: FileText, minChars: number, grouped: Map<string, Array<{ value: string; occurrence: Occurrence }>>) {
  if (!STRING_EXTENSIONS.has(file.extension)) return;
  const starts = lineStarts(file.text);
  for (let start = 0; start < file.text.length; start++) {
    const quote = file.text[start];
    if (quote !== '"' && quote !== "'" && quote !== '`') continue;
    let end = start + 1, escaped = false;
    for (; end < file.text.length; end++) {
      const char = file.text[end];
      if (escaped) { escaped = false; continue; }
      if (char === '\\') { escaped = true; continue; }
      if (char === quote) break;
      if (quote !== '`' && (char === '\n' || char === '\r')) break;
    }
    if (file.text[end] !== quote) continue;
    const value = file.text.slice(start + 1, end).replace(/\r\n?/g, '\n').trim();
    if (value.length >= minChars && !(quote === '`' && value.includes('${'))) add(grouped, 'string', value, location(file, starts, start));
    start = end;
  }
}

function textBlocks(file: FileText, minLines: number, minChars: number, grouped: Map<string, Array<{ value: string; occurrence: Occurrence }>>) {
  if (!TEXT_BLOCK_EXTENSIONS.has(file.extension)) return;
  const lines = file.text.replace(/\r\n?/g, '\n').split('\n');
  let start = 0;
  const collect = (end: number) => {
    const value = lines.slice(start, end).map(line => line.trimEnd()).join('\n').trim();
    if (end - start >= minLines && value.length >= minChars) add(grouped, 'text-block', value, { file: file.file, line: start + 1, column: 1, endLine: end });
  };
  for (let index = 0; index <= lines.length; index++) {
    if (index === lines.length || lines[index].trim() === '') { collect(index); start = index + 1; }
  }
}

function colorTokens(files: FileText[]) {
  const tokens = new Map<string, string[]>();
  const definitions = new Set<string>();
  for (const file of files) {
    if (!['.css', '.less', '.sass', '.scss'].includes(file.extension)) continue;
    for (const match of file.text.matchAll(CSS_TOKEN)) {
      const token = match[1], value = match[2].toLowerCase(), offset = match.index! + match[0].lastIndexOf(match[2]);
      const current = tokens.get(value) || [];
      if (!current.includes(token)) current.push(token);
      tokens.set(value, current.sort());
      definitions.add(`${file.file}\0${offset}`);
    }
  }
  return { tokens, definitions };
}

/** Exact literal evidence only. Candidates need human judgment before extraction or enforcement. */
export function findDuplicateLiterals(root: string, input: DuplicatePatternOptions = {}): LiteralReport {
  const setting = options(input), resolved = rootPath(root), { files, errors, skippedOversizedFiles, gitignoreApplied } = readableTextFiles(resolved, setting.exclude || []);
  const grouped = new Map<string, Array<{ value: string; occurrence: Occurrence }>>();
  const { tokens, definitions } = colorTokens(files);
  for (const file of files) {
    stringLiterals(file, setting.minStringChars, grouped);
    textBlocks(file, setting.minLines, setting.minStringChars, grouped);
    if (COLOR_EXTENSIONS.has(file.extension)) {
      const starts = lineStarts(file.text);
      for (const match of file.text.matchAll(HEX_COLOR)) {
        const value = match[0].toLowerCase();
        add(grouped, 'color', value, { ...location(file, starts, match.index!), tokenDefinition: definitions.has(`${file.file}\0${match.index!}`) || undefined });
      }
    }
  }
  const candidates = [...grouped].flatMap(([key, entries]) => {
    const [kind, value] = key.split('\0') as [LiteralKind, string];
    const token = tokens.get(value)?.[0] || (value.length === 9 ? tokens.get(value.slice(0, 7))?.[0] : undefined);
    const directOccurrences = entries.filter(entry => !entry.occurrence.tokenDefinition).length;
    if ((token ? directOccurrences : entries.length) < setting.minOccurrences) return [];
    const preview = kind === 'color' ? { value } : shown(value, kind === 'text-block' ? 'text block' : 'string');
    return [{
      kind,
      fingerprint: hash(value),
      value: preview.value,
      chars: value.length,
      occurrences: setting.maxOccurrences ? entries.slice(0, setting.maxOccurrences).map(entry => entry.occurrence) : entries.map(entry => entry.occurrence),
      occurrenceCount: entries.length,
      occurrencesTruncated: setting.maxOccurrences !== 0 && entries.length > setting.maxOccurrences,
      ...(preview.redacted ? { redacted: true as const } : {}),
      ...(kind === 'color' && token ? { directOccurrences, token, ...(value.length === 9 && !tokens.has(value) ? { alphaSuffix: value.slice(7) } : {}) } : {}),
    } satisfies LiteralCandidate];
  }).sort((left, right) => right.occurrenceCount - left.occurrenceCount || left.kind.localeCompare(right.kind) || left.fingerprint.localeCompare(right.fingerprint));
  return { filesScanned: files.length, candidates: setting.maxResults ? candidates.slice(0, setting.maxResults) : candidates, candidateCount: candidates.length, truncated: setting.maxResults !== 0 && candidates.length > setting.maxResults, errors, skippedOversizedFiles, gitignoreApplied, complete: errors.length === 0 };
}

export function jscpdCommand(root: string, output: string, input: DuplicatePatternOptions = {}) {
  const setting = options(input);
  const ignore = [...SKIP_DIRECTORIES].map(name => `**/${name}/**`).concat(SKIP_DIRECTORY_GLOBS, [...SKIP_FILES].map(name => `**/${name}`), SENSITIVE_GLOBS, setting.exclude || []).join(',');
  return {
    command: 'npm',
    cwd: root,
    config: join(output, 'ascr-jscpd.json'),
    args: ['exec', '--yes', `--package=jscpd@${JSCPD_VERSION}`, '--', 'jscpd', '--config', join(output, 'ascr-jscpd.json'), '--mode', 'strict', '--min-tokens', String(setting.minTokens), '--min-lines', String(setting.minLines), '--reporters', 'json,silent', '--no-colors', '--fail-on-empty', '--ignore', ignore, '--output', output, '.'],
  };
}

function cloneLocation(value: unknown, root: string) {
  if (!value || typeof value !== 'object') return null;
  const source = value as Record<string, unknown>;
  if (typeof source.name !== 'string' || !Number.isSafeInteger(source.start) || !Number.isSafeInteger(source.end)) return null;
  return { file: isAbsolute(source.name) ? posix(relative(root, source.name)) : source.name.replaceAll('\\', '/'), startLine: source.start, endLine: source.end };
}

type JscpdReport = { duplicates?: unknown[]; statistics?: { total?: { sources?: number } } };
type GroupedClone = Omit<CloneCandidate, 'occurrences' | 'occurrenceCount' | 'occurrencesTruncated'> & { allOccurrences: Array<{ file: string; startLine: number; endLine: number }> };

/** Normalizes jscpd's clone pairs into one candidate per exact fragment. */
export function normalizeJscpdReport(root: string, report: JscpdReport, input: DuplicatePatternOptions = {}): CloneReport {
  const setting = options(input), grouped = new Map<string, GroupedClone>();
  for (const duplicate of report.duplicates || []) {
    if (!duplicate || typeof duplicate !== 'object') continue;
    const source = duplicate as Record<string, unknown>, first = cloneLocation(source.firstFile, root), second = cloneLocation(source.secondFile, root), fragment = typeof source.fragment === 'string' ? source.fragment : '';
    if (!first || !second || !fragment) continue;
    const fingerprint = hash(fragment), preview = shown(fragment, 'duplicate block');
    const current = grouped.get(fingerprint) || {
      kind: typeof source.kind === 'string' ? source.kind : 'exact',
      format: typeof source.format === 'string' ? source.format : 'unknown',
      lines: typeof source.lines === 'number' ? source.lines : 0,
      tokens: typeof source.tokens === 'number' ? source.tokens : 0,
      fingerprint,
      excerpt: preview.value,
      ...(preview.redacted ? { redacted: true as const } : {}),
      allOccurrences: [],
    } satisfies GroupedClone;
    for (const occurrence of [first, second]) if (!current.allOccurrences.some(item => item.file === occurrence.file && item.startLine === occurrence.startLine && item.endLine === occurrence.endLine)) current.allOccurrences.push(occurrence);
    grouped.set(fingerprint, current);
  }
  const candidates = [...grouped.values()].map(candidate => {
    const allOccurrences = candidate.allOccurrences.sort((left, right) => left.file.localeCompare(right.file) || left.startLine - right.startLine || left.endLine - right.endLine);
    const { allOccurrences: _, ...pattern } = candidate;
    return {
      ...pattern,
      occurrences: setting.maxOccurrences ? allOccurrences.slice(0, setting.maxOccurrences) : allOccurrences,
      occurrenceCount: allOccurrences.length,
      occurrencesTruncated: setting.maxOccurrences !== 0 && allOccurrences.length > setting.maxOccurrences,
    } satisfies CloneCandidate;
  }).sort((left, right) => right.tokens - left.tokens || right.lines - left.lines || left.fingerprint.localeCompare(right.fingerprint));
  return { engine: { name: 'jscpd', version: JSCPD_VERSION, mode: 'strict' }, candidates: setting.maxResults ? candidates.slice(0, setting.maxResults) : candidates, candidateCount: candidates.length, truncated: setting.maxResults !== 0 && candidates.length > setting.maxResults };
}

function cloneCandidates(root: string, input: DuplicatePatternOptions): CloneReport {
  const output = mkdtempSync(join(tmpdir(), 'ascr-jscpd-'));
  try {
    const invocation = jscpdCommand(root, output, input);
    writeFileSync(invocation.config, '{}');
    execFileSync(invocation.command, invocation.args, { cwd: invocation.cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 120_000 });
    const report = JSON.parse(readFileSync(join(output, 'jscpd-report.json'), 'utf8')) as JscpdReport;
    if (!Number.isSafeInteger(report.statistics?.total?.sources) || report.statistics.total.sources < 1) throw new Error('jscpd reported no scanned source files.');
    return normalizeJscpdReport(root, report, input);
  } catch (error) { throw new Error(`jscpd@${JSCPD_VERSION} failed: ${error instanceof Error ? error.message : String(error)}`); }
  finally { rmSync(output, { recursive: true, force: true }); }
}

/** Read-only duplicate audit: jscpd finds token blocks; local scanning covers static strings and CSS colors. */
export function duplicatePatterns(root: string, input: DuplicatePatternOptions = {}) {
  const resolved = rootPath(root), setting = options(input), literals = findDuplicateLiterals(resolved, setting);
  return {
    root: resolved,
    literals,
    clones: setting.literalsOnly ? { skipped: true, reason: 'Requested --literals-only.' } : cloneCandidates(resolved, setting),
    note: 'Candidates are evidence, not a verdict that reuse is wrong. Future gates should baseline only reviewed, high-confidence findings.',
  };
}
