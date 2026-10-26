# agent-scrpts contributor notes

Read [README.md](README.md), [docs/API.md](docs/API.md), and
[tools/index.json](tools/index.json) before changing behavior. Reuse a focused
TypeScript tool when one exists; registered CLIs live in `tools/` and reusable
modules in `src/`. Avoid speculative abstractions and keep non-trivial changes
covered by focused model-free tests.

Use ordinary code for deterministic work. The optional classifier is only for
bounded typed judgments over supplied state; validate its result and handle
`status:"review"` deliberately. It is not a browser driver, a free-form
generator, or authorization for external actions.

Public clone/test/tool commands must not provision accounts, edit profiles or
global instructions, install a background service, download models, or create
and push a repository. Local inference and LaunchAgent operations are explicit
runtime choices and retain their loopback, token, host, and origin protections.

Run `npm test` before proposing a change. Do not commit credentials, local
configuration, model weights, task data, or logs. Use a focused feature branch,
preserve concurrent work, and use conventional commits.
