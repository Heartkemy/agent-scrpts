import { Workers } from './workers.ts';
import { validateAnswerSet } from './protocol.ts';
import type { Config, Request } from './protocol.ts';
export const SMOKE: Request = { state: 'I was charged twice. Please refund the duplicate payment.', cache: false, questions: {
  department: { type: 'choice', instructions: 'Which department handles this?', criteria: ['billing', 'technical', 'sales'] },
  refund: { type: 'noul', instructions: 'Does the customer request a refund?' },
  urgency: { type: 'score', instructions: 'How urgent is this request?', criteria: ['routine', 'soon', 'critical'] },
} };
export async function smokeModels(config: Config): Promise<any[]> {
  const results: any[] = [];
  for (const model of config.models.filter(m => m.enabled)) {
    const workers = new Workers(config);
    try {
      const samples: number[] = []; let last: any; let cold: any;
      for (let i = 0; i < 4; i++) {
        const start = performance.now();
        last = validateAnswerSet(await workers.predict(model, SMOKE, Date.now() + config.requestTimeoutMs), SMOKE);
        const elapsed = performance.now() - start;
        if (i === 0) cold = { elapsedMs: elapsed, runtime: last.runtime }; else samples.push(elapsed);
      }
      samples.sort((a, b) => a - b);
      results.push({ model: model.id, operational: true, cold, warmMedianMs: samples[1],
        sanity: { billingSelected: last.answers.department.choice === 'billing', refundAboveHalf: last.answers.refund.noul > 0.5 },
        note: 'A tiny functional sanity check, not an accuracy or calibration benchmark.' });
    } catch (e) {
      results.push({ model: model.id, operational: false, error: e instanceof Error ? e.message : String(e) });
    } finally { workers.close(); }
  }
  return results;
}
