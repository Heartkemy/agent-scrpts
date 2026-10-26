# agent-scrpts

Deterministic TypeScript tools and an optional local typed-decision service for
coding agents. Deterministic work stays in code; classifier use is explicit,
typed, and fallible. This project is not an MCP server or a replacement coding
harness.

## Quick start

Requirements: Node 22.18 or newer. Git is required for the clone path below and
for the worktree helper.

```sh
git clone https://github.com/Heartkemy/agent-scrpts.git
cd agent-scrpts
npm test
npm run ascr -- tools
printf '{"value":42}' | npm run ascr -- run json-pick /value
```

The clone, test suite, and registered deterministic tools do not create a
GitHub repository, change global instructions or shell profiles, install a
service, download model weights, or alter an existing installation. Tests use
temporary fixtures only.

Useful deterministic tools include `json-pick`, `sha256`, `text-references`,
`http-probe`, `duplicate-patterns`, `project-disposables`, `sqlite-wal`, and
`macos-app-copies`. `classify-jsonl` is runtime-dependent. Run
`npm run ascr -- tools` to see the current registry and use a tool's documented
options where it supports `--help`.
`duplicate-patterns` can retrieve its pinned `jscpd` package on first use; use
`--literals-only` when a zero-download check is required.

## Optional local runtime

Inference commands (`decide`, `route`, `models`, `doctor`, `self-test`, and
`service`) require an explicitly configured local runtime. Set `ASCR_CONFIG`
to a private configuration file, or use the default
`~/.config/agent-scrpts/config.json`; the configuration contract is defined in
[`src/protocol.ts`](src/protocol.ts). The runtime remains loopback-only,
token-authenticated, and rejects browser origins and unexpected hosts.

This repository deliberately does not provide a public provisioning installer.
It will not install dependencies or model weights, edit profiles or global agent
instructions, create accounts or repositories, or install/start a LaunchAgent
as an implicit side effect. Existing local configurations, services, tools, and
model files are not changed or removed by this repository update.

The maintained model metadata is in [`model-lock.json`](model-lock.json); runtime
research and compatibility limits are in [docs/RESEARCH.md](docs/RESEARCH.md).
Model checksums are intentional integrity data, not secrets. The classifier
supports choice, ordered score, and P(true), not free-form generation or image
input. A `review` result needs an explicit fallback.

## Development

Run `npm test` for the complete model-free suite. Maintainers with verified push
authority may use the existing worktree helper:

```sh
npm run ascr -- worktree new improve-tool
```

`ascr worktree integrate` fetches, merges, and pushes `main`; external
contributors should use a feature branch and pull request instead.

Read [CONTRIBUTING.md](CONTRIBUTING.md), [AGENTS.md](AGENTS.md), and
[docs/API.md](docs/API.md) before changing runtime behavior. Report questions
and non-security bugs through [SUPPORT.md](SUPPORT.md); report vulnerabilities
through [SECURITY.md](SECURITY.md).

## License and third-party terms

Original source is available under the [MIT License](LICENSE). Dependencies,
model weights, and any user-supplied voice or audio remain under their own
terms; see [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
