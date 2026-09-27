import { createHash } from 'node:crypto';
import { AppError, validateRequest, validateAnswerSet, assess } from './protocol.ts';
import type { Config, Model, Request } from './protocol.ts';
import type { Backend } from './workers.ts';
export class Router {
  config: Config; backend: Backend;
  cache = new Map<string, { until: number; value: any }>();
  constructor(config: Config, backend: Backend) { this.config = config; this.backend = backend; }
  fallback(candidates: Model[], req: Request): Model {
    const foreign = req.language && !/^en(?:[-_]|$)/i.test(req.language);
    const order = foreign ? ['laya-multilingual', 'decider-0.8b', 'laya-typed', 'laya-english'] : ['laya-typed', 'decider-0.8b', 'laya-multilingual', 'laya-english'];
    return [...candidates].sort((a, b) => {
      const rank = (id: string) => { const n = order.indexOf(id); return n < 0 ? 50 : n; };
      return rank(a.id) - rank(b.id);
    })[0];
  }
  async choose(request: Request, deadline: number): Promise<{ model: Model; routing: any }> {
    const req = validateRequest(request), explicit = req.model && req.model !== 'auto';
    let pool = this.config.models.filter(m => m.enabled && (!explicit || m.id === req.model));
    if (explicit && pool.length === 0) throw new AppError('MODEL_UNAVAILABLE', 'The requested model is not installed and enabled.', 422);
    const candidates: Model[] = [], excluded: any[] = [];
    const n = Math.max(...Object.values(req.questions).map(q => q.type === 'choice' ? (Array.isArray(q.criteria) ? q.criteria.length : Object.keys(q.criteria as object).length) : 2));
    for (const model of pool) {
      if (n > model.maxChoices) { excluded.push({ model: model.id, reason: 'option_limit' }); continue; }
      try { await this.backend.inspect(model, req, deadline); candidates.push(model); }
      catch (e) {
        if (!(e instanceof AppError) || e.status === 504) throw e;
        excluded.push({ model: model.id, reason: e.code, details: e.details });
      }
    }
    if (!candidates.length) throw new AppError('NO_COMPATIBLE_MODEL', 'No installed model can read this complete request. Reduce the bounded state or schema explicitly; nothing was silently truncated.', 422, excluded);
    if (explicit || candidates.length === 1) return { model: candidates[0], routing: { mode: explicit ? 'explicit' : 'only-compatible', selected: candidates[0].id, excluded } };
    const fixed = this.config.models.find(m => m.id === this.config.router && m.enabled);
    const fallback = this.fallback(candidates, req);
    const routeInfo: any = { selected: fallback.id, mode: 'fallback', candidates: candidates.map(m => m.id), excluded, router: fixed?.id ?? null };
    if (!fixed) { routeInfo.reason = 'routing_model_unavailable'; return { model: fallback, routing: routeInfo }; }
    // Deliberately bounded metadata for routing, never a shortened request for the final classifier.
    const routeRequest: Request = {
      state: { task: (req.task ?? '').slice(0, 150), language: req.language ?? 'unspecified',
        question: Object.values(req.questions)[0].instructions.slice(0, 120),
        sample: (typeof req.state === 'string' ? req.state : JSON.stringify(req.state)).slice(0, 160) },
      questions: { backend: { type: 'choice', instructions: 'Choose the suitable specialist. Use multilingual for non-English, typed for workflow decisions, decider for more complex judgments.',
        criteria: Object.fromEntries(candidates.map(m => [m.id, m.description.slice(0, 72)])) } },
    };
    try {
      const started = performance.now();
      await this.backend.inspect(fixed, routeRequest, deadline);
      const raw = validateAnswerSet(await this.backend.predict(fixed, routeRequest, deadline), routeRequest);
      const answer = raw.answers.backend;
      const ps = Object.values(answer.probabilities).sort((a: any, b: any) => b - a) as number[];
      routeInfo.probabilities = answer.probabilities;
      routeInfo.ms = Math.round((performance.now() - started) * 1000) / 1000;
      const selected = candidates.find(m => m.id === answer.choice);
      if (selected && ps[0] >= 0.55 && ps[0] - ps[1] >= 0.10) {
        routeInfo.selected = selected.id; routeInfo.mode = 'classifier';
        return { model: selected, routing: routeInfo };
      }
      routeInfo.reason = 'uncertain_routing';
    } catch (e) {
      if (e instanceof AppError && e.status === 504) throw e;
      routeInfo.reason = e instanceof AppError ? e.code : 'routing_failed';
    }
    return { model: fallback, routing: routeInfo };
  }
  async classify(value: unknown, deadline: number): Promise<any> {
    const started = performance.now(), req = validateRequest(value);
    // Preserve insertion/option order: changing it can change a classifier's answer.
    const key = createHash('sha256').update(JSON.stringify(req)).update(JSON.stringify(this.config.models)).digest('hex');
    if (req.cache !== false) {
      const hit = this.cache.get(key);
      if (hit && hit.until > Date.now()) {
        const result = structuredClone(hit.value); result.meta.cached = true;
        result.meta.elapsedMs = Math.round((performance.now() - started) * 1000) / 1000; return result;
      }
    }
    const { model, routing } = await this.choose(req, deadline);
    const native = validateAnswerSet(await this.backend.predict(model, req, deadline), req);
    const assessment = assess(native.answers, req.policy);
    const needsReview = Object.values(assessment).some(a => a.needsReview);
    const result = { model: model.id, nativeModel: native.model, revision: model.revision, answers: native.answers,
      usage: native.usage ?? null, status: needsReview ? 'review' : 'ok',
      meta: { routing, assessment, cached: false, runtime: native.runtime ?? null,
        elapsedMs: Math.round((performance.now() - started) * 1000) / 1000,
        calibration: 'Thresholds are heuristics, not a measured error guarantee. Validate on your own labeled tasks.' } };
    if (req.cache !== false) {
      while (this.cache.size >= 256) this.cache.delete(this.cache.keys().next().value!);
      this.cache.set(key, { until: Date.now() + 300_000, value: structuredClone(result) });
    }
    return result;
  }
}
export class SerialQueue {
  limit: number; pending = 0; tail: Promise<unknown> = Promise.resolve();
  constructor(limit: number) { this.limit = limit; }
  async run<T>(operation: () => Promise<T>, deadline: number): Promise<T> {
    if (this.pending >= this.limit) throw new AppError('BUSY', 'Local inference queue is full.', 503);
    this.pending++;
    const task = this.tail.catch(() => {}).then(() => {
      if (Date.now() >= deadline) throw new AppError('TIMEOUT', 'Deadline elapsed while waiting for local inference.', 504);
      return operation();
    });
    this.tail = task;
    try { return await task; } finally { this.pending--; }
  }
}
