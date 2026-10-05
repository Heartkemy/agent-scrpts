# agent-scrpts

Shared TypeScript utilities + local typed decisions for coding agents. Deterministic operations stay in code. Bounded semantic classification can be one explicit, fallible step inside that code. No MCP and no replacement coding harness.

Default repository: `~/__code__/agent-scrpts/`. The spelling is intentional.

## Install

Run the self-contained `bootstrap.ts` with your existing recent Node:

```sh
node bootstrap.ts
```

Normal installation targets Apple Silicon with macOS 15 or later, Node >=22.18 (or >=23.6). Node is not installed or replaced. Existing oMLX is not changed. Homebrew, git, gh, uv and a managed Python 3.12 are installed when needed. Homebrew/system prerequisites can request native administrator approval; GitHub login can open a browser when not already authenticated. Run as your ordinary user, never `sudo node ...`. No script can legitimately bypass those approvals.

The bootstrap writes the source repository, runs its weight-free tests, creates separate inference environments, resolves hashed dependency locks and pinned model revisions, downloads weights, tests actual model calls, configures a local API and login LaunchAgent, adds `ascr` to `~/.local/bin`, appends managed Codex instructions, creates a **private** GitHub repository and commits/pushes the setup. Credentials, weights and local task state stay outside Git. It does not install a GitHub connector or request access to your other repositories.

Default models: Laya English, multilingual and typed-decision MLX checkpoints, plus Decider 0.8B on MPS. `--with-decider-2b` adds 2B; `--mlx-only` omits Decider. Other research is in `docs/RESEARCH.md`. Small does not guarantee useful accuracy for your tasks. Setup reports measured cold/warm timings and a tiny functional check, not production calibration.

```sh
node bootstrap.ts --help
node bootstrap.ts --dry-run
node bootstrap.ts --mlx-only
node bootstrap.ts --with-decider-2b
```

The script is resumable: it preserves existing source files and existing model/dependency pins. Rerun the same command after resolving an installation problem. It refuses a nonempty unmanaged destination and conflicting public remotes. It never force-pushes or discards local changes. `--no-github` and `--no-service` are explicit partial-install modes; normal installation does both. `--scaffold-only --root /some/empty/folder` emits source only without touching your Mac configuration, installing dependencies or calling GitHub.

Bootstrap updates are **not** a source-upgrade mechanism. Agents own the evolving repository after creation. Existing source is not overwritten; when changing an adapter, update its tests and dependencies deliberately. Requirements inputs, first-install hashed locks and model-lock.json are versioned. The original bootstrap is retained as `bootstrap.ts` for resume/reinstall.

## Use

Open a new terminal, or run `export PATH="$HOME/.local/bin:$PATH"` in the current one. Start a new Codex session to load updated global instructions.

```sh
ascr help
ascr doctor
ascr models
ascr decide --file ~/__code__/agent-scrpts/examples/request.json
ascr route --file ~/__code__/agent-scrpts/examples/request.json
ascr self-test
ascr tools
printf '{"value":42}' | ascr run json-pick /value
ascr run sha256 ./some-file.txt
ascr run sqlite-wal ./archived.sqlite-wal
ascr run http-probe --user-agent Twitterbot/1.0 --body-chars 2000 https://example.com/robots.txt
ascr run text-references references.json
ascr run macos-app-copies --bundle-id com.example.app --keep /Applications/Example.app /Applications ~/Downloads
ascr run classify-jsonl template.json rows.jsonl > results.jsonl
ascr test
```

`text-references` accepts `{files: string[], needles: string[]}` and returns exact matches with file/line evidence. Missing matches are investigation candidates, not proof of dead code; callers must trace dynamic lookups separately. It performs no writes or model calls.

`sqlite-wal` validates SQLite WAL salts and rolling checksums until the first invalid frame. Optional arguments `<base-db> <NEW-candidate-db>` create a separate forensic overlay including unfinished transaction pages. Inputs are never overwritten. The candidate may be malformed: preserve the original archive, independently validate SQLite integrity and extracted records, and never install the overlay as a live database. Trailing frames after the first invalid frame are excluded.

`classify-jsonl` applies one request template (all fields except `state`) to JSONL rows `{id,state}` using the existing local client. IDs must be unique nonempty trimmed strings. The whole batch is validated before sequential inference; each stdout row preserves the full response and input ID. Exit 3 preserves all results when any need review; exit 1 stops on a fatal error and may leave earlier results in stdout. Inputs are never truncated. Keep private task data outside Git; independently review classifications before taking action. Run with `--help` for usage.

`decide` exit 0 means the configured heuristic thresholds were met, **not proven correctness**. Exit 3 means review required; exit 1 means an error. Scripts can call HTTP directly or import `src/client.ts`; do not launch a CLI or an MCP server for each native API call.

The classifier interface supports choice, ordered score and P(true), not text generation or screenshot input. `examples/browser-choice.ts` shows bounded candidate selection with a review gate, but deliberately does not drive a browser. Native browser/computer integration remains a task-specific reusable script an agent can build.

## Repository maintenance

```sh
ascr worktree new improve-tool
# Work in the path printed above; add tests; git add/commit there.
ascr worktree integrate /absolute/path/printed/above
ascr service restart  # after changes that affect the running service
```

Each agent receives its own branch/worktree. Integration is serialized, merges the latest remote main and the agent branch in a disposable worktree, tests the merged result, pushes without force and cleans up only completed work. Conflicts stop and preserve work. Do not delete another agent's live lock or worktree. In `--no-github` mode, these helpers need an origin/main before they can operate.

## Local files

- `~/.config/agent-scrpts/config.json`: runtime settings, model paths and token-file location (private).
- `~/.config/agent-scrpts/token`: bearer token, mode 0600; never commit it.
- `~/.local/share/agent-scrpts/envs/`: isolated native inference environments.
- Hugging Face cache: pinned weight snapshots; no copies in the Git repository.
- `~/.local/share/agent-scrpts/setup-report.json`: installation results and model smoke checks.
- `~/.local/share/agent-scrpts/backups/`: backups of edited global/profile files.
- `~/Library/LaunchAgents/local.agent-scrpts.plist`: per-user service, not a root daemon.
- `${CODEX_HOME:-~/.codex}/AGENTS.md`: appended managed block; existing `AGENTS.override.md` receives the same block because it otherwise shadows AGENTS.md.
- zsh startup files (honoring ZDOTDIR): managed PATH block. Existing content is preserved.

Default port is 7331; a free port is chosen on first setup if necessary. The actual value is in config and generated global instructions. HTTP is bound only to 127.0.0.1 with token authentication and browser-origin rejection. Inference is offline after installation. Requests are not logged or written to Git; exact-result caching is in memory only and can be disabled.

Workers load lazily, run one inference at a time, evict competing models and release after inactivity. These controls help coexist with oMLX but cannot reserve memory used by your other applications. A busy oMLX instance may still require unloading its models or a smaller installation. The bootstrap does not make that choice for you.

## Troubleshooting and removal

Read setup-report.json and the explicit failed stage. `ascr doctor` checks configuration and service health. `ascr self-test` actually calls each enabled model through the service. The bootstrap disables models failing its structural smoke test rather than claiming success. Installation failures return a nonzero exit code; successfully installed components are preserved for retry.

The native adapter is intentionally pinned and uses upstream token-formatting internals to prevent silent truncation. A future upstream/package/model change can break it; do not independently upgrade one side. First installation needs network access and external packages. Model revisions and transitive lockfiles are pinned on that first resolution, not all pre-resolved inside the ZIP.

`ascr service uninstall` removes startup registration and stops the service, but preserves source, weights and configuration. To fully remove, also remove the marked agent/PATH blocks, CLI wrapper, repository and local state after backing up anything useful. Hugging Face snapshots may be shared with other tools; do not blindly delete the entire cache.

## Verification boundary

The source is accompanied by weight-free tests for request/output validation, routing/fallback/cache behavior, authenticated HTTP, deterministic tools and local Git worktree integration. Hardware inference cannot be established by these tests. Real MLX/MPS installation and model tests run on your Mac during bootstrap. Treat the resulting timings and task-specific evaluations as the relevant evidence.
