import { spawn } from 'node:child_process';
import type { ChildProcessWithoutNullStreams } from 'node:child_process';
import { createInterface } from 'node:readline';
import { join } from 'node:path';
import { AppError } from './protocol.ts';
import type { Config, Model, Request } from './protocol.ts';
export type Backend = { inspect(model: Model, req: Request, deadline: number): Promise<any>; predict(model: Model, req: Request, deadline: number): Promise<any>; close(): void };
class Worker {
  config: Config; family: string; child?: ChildProcessWithoutNullStreams;
  pending = new Map<number, { resolve: (v: any) => void; reject: (e: Error) => void; timer: NodeJS.Timeout }>();
  counter = 0;
  constructor(config: Config, family: string) { this.config = config; this.family = family; }
  start(): void {
    if (this.child) return;
    const python = this.config.python[this.family];
    if (!python) throw new AppError('RUNTIME_MISSING', `No ${this.family} runtime is configured.`, 503);
    const child = spawn(python, ['-u', join(this.config.root, 'runtime', 'worker.py')], {
      cwd: this.config.root, stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, HF_HUB_OFFLINE: '1', TRANSFORMERS_OFFLINE: '1', HF_HUB_DISABLE_TELEMETRY: '1', TOKENIZERS_PARALLELISM: 'false' },
    });
    this.child = child;
    // Deliberately discard upstream stderr rather than persist arbitrary model-library output.
    child.stderr.resume();
    const fail = () => {
      if (this.child !== child) return;
      this.child = undefined;
      for (const p of this.pending.values()) { clearTimeout(p.timer); p.reject(new AppError('WORKER_EXITED', `${this.family} worker exited; no classification was accepted.`, 503)); }
      this.pending.clear();
    };
    child.once('error', fail); child.once('exit', fail);
    createInterface({ input: child.stdout }).on('line', (line) => {
      if (this.child !== child) return;
      let data: any;
      try { data = JSON.parse(line); } catch { this.stop(); return; }
      const p = this.pending.get(data.id); if (!p) return;
      clearTimeout(p.timer); this.pending.delete(data.id);
      if (data.error) p.reject(new AppError(data.error.code ?? 'BACKEND_FAILURE', data.error.message ?? 'Backend failed.', ['INPUT_TOO_LONG', 'SCHEMA_TOO_LARGE'].includes(data.error.code) ? 422 : 503, data.error.details));
      else p.resolve(data.result);
    });
  }
  async call(payload: object, deadline: number): Promise<any> {
    if (Date.now() >= deadline) throw new AppError('TIMEOUT', 'Request deadline exceeded.', 504);
    this.start(); const id = ++this.counter;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id); reject(new AppError('TIMEOUT', 'Local inference exceeded its deadline; worker stopped.', 504)); this.stop();
      }, deadline - Date.now());
      this.pending.set(id, { resolve, reject, timer });
      this.child!.stdin.write(JSON.stringify({ ...payload, id }) + '\n', error => { if (error) this.stop(); });
    });
  }
  stop(): void {
    const child = this.child; this.child = undefined;
    for (const p of this.pending.values()) { clearTimeout(p.timer); p.reject(new AppError('WORKER_STOPPED', 'Worker stopped before completing inference.', 503)); }
    this.pending.clear(); child?.kill('SIGKILL');
  }
}
export class Workers implements Backend {
  config: Config; pool: Record<string, Worker>; idle?: NodeJS.Timeout;
  constructor(config: Config) { this.config = config; this.pool = { laya: new Worker(config, 'laya'), decider: new Worker(config, 'decider') }; }
  touch(): void {
    if (this.idle) clearTimeout(this.idle);
    this.idle = setTimeout(() => this.close(), this.config.idleSeconds * 1000); this.idle.unref();
  }
  async inspect(model: Model, request: Request, deadline: number): Promise<any> {
    if (this.idle) clearTimeout(this.idle);
    try { return await this.pool[model.family].call({ op: 'inspect', model, request }, deadline); }
    finally { this.touch(); }
  }
  async predict(model: Model, request: Request, deadline: number): Promise<any> {
    if (this.idle) clearTimeout(this.idle);
    try {
      if (model.family === 'decider') {
        // Never leave both Laya specialists and Decider weights resident.
        const w = this.pool.laya;
        if (w.child) await w.call({ op: 'unload', keep: this.config.lowMemory ? [] : [this.config.router] }, deadline);
      } else if (model.id !== this.config.router) {
        this.pool.decider.stop();
        if (this.pool.laya.child) await this.pool.laya.call({ op: 'unload', keep: this.config.lowMemory ? [model.id] : [this.config.router, model.id] }, deadline);
      } else if (this.config.lowMemory) {
        this.pool.decider.stop();
      }
      return await this.pool[model.family].call({ op: 'predict', model, request, memoryBudgetBytes: this.config.memoryBudgetBytes }, deadline);
    } finally { this.touch(); }
  }
  close(): void { if (this.idle) clearTimeout(this.idle); this.idle = undefined; Object.values(this.pool).forEach(w => w.stop()); }
}
