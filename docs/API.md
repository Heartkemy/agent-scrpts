# Native HTTP / TypeScript API

The starter implements one local API over upstream Laya and Decider Python inference methods. It is not an oMLX endpoint and is not an MCP server. Workflow code, routing, HTTP, CLI, caching and Git management are TypeScript. A small private JSONL subprocess bridge is needed because the verified native runtimes expose Python APIs, not a verified Node binding.

Endpoint: `http://127.0.0.1:<port>` (normally 7331). Actual URL, model paths and token path: `~/.config/agent-scrpts/config.json`. Bearer token: separate mode-0600 local file. The API accepts local non-browser clients only: it rejects Origin headers and unexpected Host values, has no CORS and is not exposed on the network. Do not reverse-proxy it publicly. This does not protect against arbitrary code already running as your user.

## Operations

- `GET /health`: process/queue health. Lazy readiness is not an assertion that every model is loaded; run `ascr self-test` for actual inference.
- `GET /v1/models`: model IDs, pinned revisions, effective limits and available question types, without private snapshot paths.
- `POST /v1/route`: compatibility checks and router decision only, not the final classification.
- `POST /v1/systemone`: complete request -> routing -> native typed answers plus normalized assessment.

```json
{
  "state": "I was charged twice. Please refund the duplicate payment.",
  "task": "customer request triage",
  "language": "en",
  "questions": {
    "department": {
      "type": "choice",
      "instructions": "Which department should handle this request?",
      "criteria": {"billing":"Payments and refunds", "technical":"Product failures", "sales":"Pre-purchase questions"}
    },
    "refund": {"type":"noul", "instructions":"Does this explicitly request a refund?"},
    "urgency": {"type":"score", "instructions":"Rate urgency.", "criteria":["routine","soon","critical"]}
  },
  "model": "auto",
  "policy": {"minProbability": 0.8, "minMargin": 0.15},
  "cache": false
}
```

`state` accepts finite JSON, not only strings. Questions are keyed by stable IDs (1–16 per request).

`choice`: criteria are an ordered list of distinct strings or a label -> description map. Output includes the supplied `choice` and a probability distribution over labels. The shared schema accepts 2–255 labels, but the starter limits Laya to 16 and the token budget often imposes a stricter practical limit. Decider permits up to 255 subject to total tokens.

`score`: criteria are 2–10 ordered rubric levels. Output includes `score`, an expected **zero-based rubric position**, its legend and probabilities over string indices `"0"`, `"1"`, etc. It is not an arbitrary numerical predictor or automatically a 0–100 score. A broad distribution can require review even when its expected score looks reasonable.

`noul`: a yes/no proposition with optional `criteria:{"true":"description","false":"description"}`. Output `noul` is **P(true)**, not a Boolean. A probability near zero is a confident negative answer, not a model failure.

Native core fields are preserved. Native `confidence` definitions differ between model families; this service never interprets them as an error rate. Its independent `meta.assessment[id]` contains `topProbability`, `margin`, `needsReview` and reasons. Defaults are 0.80 top probability and 0.15 top-two margin. These are uncalibrated heuristics; tune them against your labeled tasks, not wishful confidence. A high-confidence answer can still be wrong.

Top-level `status` is `ok` or `review`. `meta.routing` identifies classifier routing, deterministic fallback, explicit selection, or only-compatible selection. Routing thresholds (0.55 top probability, 0.10 margin) are separate heuristics. Routing selects a likely specialist; it does not determine actual task accuracy. Choice/score outputs are structurally checked, including probability totals and choice membership, before acceptance.

## Native use from TypeScript

```typescript
import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
const c = JSON.parse(await readFile(join(homedir(), '.config/agent-scrpts/config.json'), 'utf8'));
const token = (await readFile(c.tokenFile, 'utf8')).trim();
const response = await fetch(`http://${c.host}:${c.port}/v1/systemone`, {
  method: 'POST',
  headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
  body: JSON.stringify(request),
  signal: AbortSignal.timeout(c.requestTimeoutMs + 5000),
});
const result = await response.json();
if (!response.ok) throw new Error(JSON.stringify(result.error));
if (result.status !== 'ok') throw new Error('Decision needs review; no action taken.');
// Resolve result.answers.<id>.choice against your original allowlist, then verify.
```

Inside this repository, `import { classify } from '../src/client.ts'` does the same authentication, request validation and error handling. Do not shell out to the CLI from scripts when a direct API call or module import suffices.

## Limits and failure behavior

Laya English: 512 tokens per formatted question. Laya multilingual / typed: 1,024 **in the pinned MLX port**. This is not the longer context sometimes quoted for a different upstream runtime. Instructions, choices, markers and state all consume this budget. Laya also has a 192-token schema prefix budget and per-option limits; the adapter detects its upstream truncation paths and rejects requests that would lose content. Literal mask-token strings are normalized by the native formatter, as documented upstream.

Decider text checkpoints: starter operational cap 2,048 tokens on a Mac below 16 GiB RAM, otherwise 4,096; this intentionally does not expose the full advertised context. The exact upstream formatter is used for preflight. Batch questions are independent; results cannot depend on another answer in the same request. Do multiple explicit stages when one answer is another question's input.

Hard limits are not a promise of good accuracy at their maximum. The wrapper accepts a schema-compatible model only after complete token preflight. A short excerpt is used for *routing metadata only*; the chosen model receives the full submitted classification input. It will not silently truncate a document or invent an answer when no model fits. Deliberate chunking/aggregation belongs in a task-specific, tested TS workflow.

No image/screenshot classification, free-text generation, arbitrary entity extraction, browser driver, browser login, tool execution or external mutation endpoint is supplied. For computer/browser use, provide compact extracted text or enumerated semantic candidates. Permissions remain the caller's responsibility.

Queueing is serialized to avoid competing GPU loads. Workers are lazy and unload after inactivity. On lower-memory Macs, switching families evicts the previous model. Cold loads and first requests can be much slower than warm inference. A fixed router is not free: preflight tokenization, loading and switching have costs. Cache: at most 256 exact requests for five minutes, RAM only; `cache:false` disables it. No task payloads are written to logs or committed by this scaffold. Child-library stderr is discarded to avoid accidental private-data logging.

HTTP failures include 400 malformed JSON, 401 auth/origin/host rejection, 413 byte limit, 415 content type, 422 incompatible input, 502 malformed native answers, 503 queue/backend unavailable, 504 timeout. The service terminates a timed-out worker. Review is a successful HTTP response, but CLI exit 3. Exit 1 means operational failure. Avoid blindly retrying irreversible workflows.
