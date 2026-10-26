# Contributing

This repository runs TypeScript directly with Node 22.18 or newer. Clone it,
then run the model-free suite before opening a pull request:

```sh
npm test
```

Useful local commands do not require a configured inference runtime:

```sh
npm run ascr -- tools
printf '{"value":42}' | npm run ascr -- run json-pick /value
```

Use a focused feature branch and conventional commit messages. Keep deterministic
work in TypeScript, add focused tests for non-trivial behavior, and preserve the
existing authentication, host/origin, checksum, and service safeguards. Do not
commit tokens, local configuration, model weights, logs, or private task data.

`ascr worktree integrate` fetches, merges, and pushes `main`; use it only with
verified maintainer authority. External contributors should open a pull request.

The local classifier is for bounded typed decisions, not free-form generation or
automatic external actions. See [AGENTS.md](AGENTS.md) and [docs/API.md](docs/API.md)
before changing runtime behavior.
