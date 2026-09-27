/** Direct HTTP client for TypeScript workflows. No MCP and no model SDK dependency. */
import { api, readConfig } from './support.ts';
import { validateRequest } from './protocol.ts';
import type { Request } from './protocol.ts';
export type { Request, Question, Json } from './protocol.ts';
export async function classify(request: Request): Promise<any> {
  return api('/v1/systemone', validateRequest(request), readConfig());
}
