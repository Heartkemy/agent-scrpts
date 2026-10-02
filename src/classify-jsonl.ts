import { classify } from './client.ts';
import { object, validateAnswerSet, validateRequest } from './protocol.ts';

/** Classify a validated batch sequentially; results are evidence, never authorization for actions. */
export async function classifyJsonl(
  template: unknown, jsonl: string, emit: (result: Record<string, any>) => void,
  decide: typeof classify = classify,
): Promise<0 | 3> {
  if (!object(template) || Object.hasOwn(template, 'state')) throw new Error('Template must be a request object without state.');
  validateRequest({ ...template, state: null });
  const lines = jsonl.split('\n');
  if (lines.at(-1) === '') lines.pop();
  if (!lines.length) throw new Error('Provide at least one JSONL row.');
  const ids = new Set<string>();
  const rows = lines.map((line, index) => {
    try {
      const row = JSON.parse(line);
      if (!object(row) || Object.keys(row).length !== 2 || !Object.hasOwn(row, 'state') ||
        typeof row.id !== 'string' || !row.id.trim() || row.id !== row.id.trim()) throw new Error('Expected {id: nonempty trimmed string, state: JSON}.');
      if (ids.has(row.id)) throw new Error(`Duplicate ID: ${row.id}`);
      ids.add(row.id);
      return { id: row.id, request: validateRequest({ ...template, state: row.state }) };
    } catch (error) {
      throw new Error(`Row ${index + 1}: ${error instanceof Error ? error.message : String(error)}`);
    }
  });
  let exitCode: 0 | 3 = 0;
  for (const { id, request } of rows) {
    try {
      const response = validateAnswerSet(await decide(request), request);
      if (!['ok', 'review'].includes(response.status)) throw new Error('Classifier response must have status ok or review.');
      if (response.status === 'review') exitCode = 3;
      emit({ ...response, id });
    } catch (error) {
      throw new Error(`ID ${id}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return exitCode;
}
