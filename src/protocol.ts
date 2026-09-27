/** Narrow typed-decision contract; no generated-text or tool-execution endpoint. */
export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
export type Question = { type: 'choice' | 'score' | 'noul'; instructions: string; criteria?: Json };
export type Request = {
  state: Json; questions: Record<string, Question>; model?: string;
  task?: string; language?: string; cache?: boolean;
  policy?: { minProbability?: number; minMargin?: number };
};
export type Model = {
  id: string; family: 'laya' | 'decider'; repo: string; revision: string;
  path: string; description: string; maxTokens: number; maxChoices: number;
  enabled: boolean; error?: string;
};
export type Config = {
  version: 1; root: string; stateDir: string; tokenFile: string; host: '127.0.0.1'; port: number;
  python: Record<string, string>; models: Model[]; router: string;
  requestTimeoutMs: number; maxQueue: number; maxBodyBytes: number;
  idleSeconds: number; memoryBudgetBytes: number; lowMemory: boolean;
};
export class AppError extends Error {
  code: string; status: number; details: unknown;
  constructor(code: string, message: string, status = 400, details?: unknown) {
    super(message); this.name = 'AppError'; this.code = code; this.status = status; this.details = details;
  }
}
export const object = (v: unknown): v is Record<string, any> => v !== null && typeof v === 'object' && !Array.isArray(v);
function bad(message: string): never { throw new AppError('INVALID_REQUEST', message, 422); }
function keys(value: Record<string, any>, allowed: string[], where: string): void {
  for (const key of Object.keys(value)) if (!allowed.includes(key)) bad(`Unknown ${where} field: ${key}`);
}
export function validateRequest(value: unknown): Request {
  if (!object(value)) bad('The request must be a JSON object.');
  keys(value, ['state', 'questions', 'model', 'task', 'language', 'cache', 'policy'], 'request');
  if (!Object.hasOwn(value, 'state')) bad('state is required.');
  // Also protects callers of the in-process API from cycles, NaN and non-JSON input.
  const visit = (v: unknown, depth: number): void => {
    if (depth > 40) bad('JSON nesting exceeds 40 levels.');
    if (v === null || typeof v === 'string' || typeof v === 'boolean') return;
    if (typeof v === 'number' && Number.isFinite(v)) return;
    if (Array.isArray(v)) { for (const x of v) visit(x, depth + 1); return; }
    if (object(v) && [Object.prototype, null].includes(Object.getPrototypeOf(v))) {
      for (const x of Object.values(v)) visit(x, depth + 1); return;
    }
    bad('Only finite JSON values are accepted.');
  };
  visit(value, 0);
  if (!object(value.questions)) bad('questions must be an object keyed by question ID.');
  const questions = Object.entries(value.questions);
  if (questions.length < 1 || questions.length > 16) bad('Use between 1 and 16 questions per request.');
  for (const [id, q] of questions) {
    if (!/^[A-Za-z0-9][A-Za-z0-9_.-]{0,79}$/.test(id)) bad('Invalid question ID.');
    if (!object(q)) bad(`Question ${id} must be an object.`);
    keys(q, ['type', 'instructions', 'criteria'], 'question');
    if (!['choice', 'score', 'noul'].includes(q.type)) bad(`Question ${id}: type must be choice, score or noul.`);
    if (typeof q.instructions !== 'string' || !q.instructions.trim() || q.instructions.length > 8000) bad(`Question ${id}: provide nonempty instructions (at most 8,000 characters).`);
    if (q.type === 'choice') {
      let labels: string[];
      if (Array.isArray(q.criteria) && q.criteria.every((s: unknown) => typeof s === 'string')) labels = q.criteria;
      else if (object(q.criteria)) labels = Object.keys(q.criteria);
      else bad(`Question ${id}: choice criteria must be labels or a label-description map.`);
      if (labels.length < 2 || labels.length > 255 || new Set(labels).size !== labels.length || labels.some(s => !s.trim())) bad(`Question ${id}: use 2–255 unique, nonempty choice labels.`);
    } else if (q.type === 'score') {
      if (!Array.isArray(q.criteria) || q.criteria.length < 2 || q.criteria.length > 10) bad(`Question ${id}: score criteria must be 2–10 ordered rubric levels.`);
    } else if (q.criteria !== undefined) {
      if (!object(q.criteria)) bad(`Question ${id}: noul criteria must be a true/false description map.`);
      keys(q.criteria, ['true', 'false'], 'noul criteria');
    }
  }
  for (const [name, max] of [['model', 80], ['task', 500], ['language', 40]] as const)
    if (value[name] !== undefined && (typeof value[name] !== 'string' || value[name].length > max)) bad(`${name} must be a string of at most ${max} characters.`);
  if (value.cache !== undefined && typeof value.cache !== 'boolean') bad('cache must be a boolean.');
  if (value.policy !== undefined) {
    if (!object(value.policy)) bad('policy must be an object.');
    keys(value.policy, ['minProbability', 'minMargin'], 'policy');
    for (const v of Object.values(value.policy)) if (typeof v !== 'number' || !Number.isFinite(v) || v < 0 || v > 1) bad('Policy thresholds must be numbers between 0 and 1.');
  }
  return value as Request;
}
export function validateAnswerSet(result: unknown, req: Request): Record<string, any> {
  if (!object(result) || !object(result.answers)) throw new AppError('BAD_BACKEND_RESPONSE', 'Backend returned no answer map.', 502);
  if (JSON.stringify(Object.keys(result.answers).sort()) !== JSON.stringify(Object.keys(req.questions).sort())) throw new AppError('BAD_BACKEND_RESPONSE', 'Backend answer IDs do not match the questions.', 502);
  const probability = (x: unknown) => typeof x === 'number' && Number.isFinite(x) && x >= 0 && x <= 1;
  for (const [id, q] of Object.entries(req.questions)) {
    const a = result.answers[id];
    const fail = () => { throw new AppError('BAD_BACKEND_RESPONSE', `Invalid typed answer for question ${id}.`, 502); };
    if (!object(a) || a.type !== q.type) fail();
    if (q.type === 'noul') { if (!probability(a.noul)) fail(); continue; }
    const labels = q.type === 'choice' ? (Array.isArray(q.criteria) ? q.criteria as string[] : Object.keys(q.criteria as object)) : (q.criteria as Json[]).map((_, i) => String(i));
    if (!object(a.probabilities) || JSON.stringify(Object.keys(a.probabilities).sort()) !== JSON.stringify([...labels].sort())) fail();
    const ps = Object.values(a.probabilities) as number[];
    if (!ps.every(probability) || Math.abs(ps.reduce((s, p) => s + p, 0) - 1) > Math.max(0.002, labels.length * 0.00006)) fail();
    if (q.type === 'choice' && (!labels.includes(a.choice) || a.probabilities[a.choice] + 0.00011 < Math.max(...ps))) fail();
    if (q.type === 'score' && (typeof a.score !== 'number' || !Number.isFinite(a.score) || a.score < 0 || a.score > labels.length - 1)) fail();
  }
  return result;
}
export function assess(answers: Record<string, any>, policy: Request['policy'] = {}): Record<string, any> {
  const minimum = policy.minProbability ?? 0.8, minMargin = policy.minMargin ?? 0.15;
  const result: Record<string, any> = {};
  for (const [id, a] of Object.entries(answers)) {
    const ps: number[] = a.type === 'noul' ? [a.noul, 1 - a.noul] : Object.values(a.probabilities);
    ps.sort((a, b) => b - a);
    const top = ps[0], margin = top - (ps[1] ?? 0);
    result[id] = { topProbability: top, margin, needsReview: top < minimum || margin < minMargin,
      reasons: [...(top < minimum ? ['low_probability'] : []), ...(margin < minMargin ? ['small_margin'] : [])] };
  }
  return result;
}
