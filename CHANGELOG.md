# Changelog

## [Unreleased]

## [0.2.0.0] - 2026-05-13 — Reliability + Headless

Focused on running the pipeline end-to-end on a real 581-project tree. Several
silent papercuts (scanner naming, JSON reliability on small Ollama models, agent
adapter concurrency) became impossible to ignore and got fixed.

### Added

- **Smarter `displayName` resolution** (`scanner.ts:resolveDisplayName`).
  Hierarchy: `package.json` name → `Cargo.toml` `[package].name` → `pyproject.toml`
  PEP-621 / Poetry name → git remote URL repo stem → parent dir when basename
  is generic (`package`, `src`, `lib`, `dist`, …) → basename. Fixes npm-tarball
  workspaces showing up as "package" and monorepo packages collapsing into
  generic basenames.
- **New project markers**: `Anchor.toml` (Solana), `foundry.toml`,
  `hardhat.config.{ts,js}` (Solidity), `build.gradle.kts` (Kotlin). Ordered
  above generic ones so a Solana program detects as `type=solana` instead of
  bare Rust, and Hardhat as Solidity instead of just Node.
- **Bench harness** (`scripts/bench-ollama.ts`). Builds project context once,
  runs each candidate model against it, scores returned `techStack` against
  signals extracted from real manifests (`package.json` deps + keywords,
  Cargo, pyproject PEP-621/Poetry, requirements.txt, go.mod, Anchor) plus a
  tech-alias map (`PostgreSQL`→`pg`, `Telegram`→`grammy`, …). Emits
  per-project + aggregate markdown tables and raw JSON. Persisted artifact
  in `scripts/results/`.
- **Agent-loop POC** (`scripts/bench-agent.ts`). Claude-style adapter that
  gives a small local model sandboxed read-only tools (`list_dir`,
  `read_file`, `grep`) and runs a multi-step exploration loop. Includes a
  `parseInlineToolCalls` fallback for models that emit tool calls inline in
  content instead of via Ollama's structured `tool_calls` field, which makes
  `qwen2.5-coder:3b` work in agent mode without pulling a larger model.
- **Headless runners** (`scripts/run-analyze.ts`, `scripts/run-publish.ts`,
  `scripts/run-cleanup.ts`). Bypass Ink so long runs (e.g. backfilling 552
  unanalyzed projects, regenerating insights, syncing publish) work under
  `nohup` without the Bun + script-PTY combo crashing.
- **Ground-truth scoring tests** (`test/bench-ollama-scoring.test.ts`)
  exercising `extractGroundTruth` and `scoreTechStack` on synthetic manifests.
- **Web portfolio UX**: language color dots in compact rows, inline
  first-sentence summary preview, 28px year header anchors, semibold org
  group headers. (Lives in the `agent-cv-web` repo; this changelog notes it
  so the CLI's published output makes visual sense.)

### Changed

- **`RECOMMENDED_OLLAMA_MODEL`**: `qwen2.5-coder:3b`. Locally verified at 95%
  ground-truth `techStack` accuracy across 12 mixed projects with median
  7.8s latency — beats `llama3.2:latest` (89% / 12.9s), `gemma3:1b` (82% /
  5.3s), and `mistral:latest` (85% / 25.1s) on the same harness.
- **`PREFERRED_OLLAMA_MODELS`** extended with `qwen3.5:4b`, `gemma4:{e2b,e4b,26b}`,
  `ministral-3:3b`, `smollm3:3b` so auto-detect picks them up once pulled.
- **Ollama adapter** sets `response_format: json_object` on the
  OpenAI-compatible endpoint; large reliability win for small models.
- **`AgentAdapter.maxConcurrency`** hint, honored by
  `pipeline/analyze.ts` when no env override is present. Local Ollama
  defaults to 1; cloud APIs keep the previous parallelism.
- **`AgentPicker`** reads `OLLAMA_MODEL_SIZE_HINTS` for the download prompt
  size instead of a hard-coded "(1.9 GB)" string.
- **`publish` confirm** shows `[Y]/n (Enter = yes)` and accepts both upper
  and lower case Y/N.

### Pre-0.2.0 unreleased work (carried forward from previous Unreleased section)

- **Monorepo:** Bun workspaces with headless code in `packages/core` (`@agent-cv/core`, workspace-private). CLI and Ink UI remain under `src/`; imports use `@agent-cv/core/src/...`.
- **Pipeline:** Phase transitions use `isValidPhaseTransition` + actor snapshot (no ref desync); clear-screen runs only after the machine actually enters an interactive phase; non-production warns on invalid `GOTO_*` sends.
- **CI (Phase E+):** `test.yml` runs tests then `bun run build:npm` (main/master, Bun 1.3.6, frozen lockfile, ignore-scripts); duplicate `ci.yml` removed to avoid double runs. Release job runs tests before build, pins Bun, uses frozen lockfile for npm publish and binary matrix builds.
- **Pipeline phase machine:** `setup()` + invoked `bootstrap` actor (`fromPromise`) for init telemetry; `showTelemetryNotice` lives on machine context; `GOTO_SCANNING` from `init` still cancels bootstrap (tests / manual skip). `defaultPipelineBootstrap` when `input` is omitted. Bootstrap `onError` clears the banner flag; `Pipeline` passes stable `useMemo` machine `input` to avoid actor re-init on render.
- **LLM JSON parsing:** Balanced-brace `extractFirstJsonObject` replaces greedy regex for structured analysis output.
- **Credentials file:** `credentials.json` is written with mode `0o600` where supported.
- **GitHub Actions:** `bun test` on push and pull request (Bun 1.3.6, `bun install --frozen-lockfile`).
- **Tests:** `waitFor` coverage for bootstrap → `scanning`, banner context, bootstrap failure, and `GOTO_SCANNING` cancelling a pending bootstrap; `test/ink-harness.test.tsx` smoke for `ink-testing-library`. Pipeline UI subprocess integration asserts first-run telemetry copy plus scanning line; runner uses `spawnSync` timeout so a hung child cannot block CI indefinitely.
- **Pipeline UI state:** XState machine (`src/pipeline/phase-machine.ts`) drives `Pipeline` phases; invalid transitions are ignored (same as before, with an explicit graph).
- **Structured analysis parsing:** `packages/core/src/analysis/api-parse.ts` — `parseStructuredAnalysisResponse`, `parseApiAnalysisResponse`, `parseOllamaAnalysisResponse`, `parseClaudeCliAnalysisResponse` / `unwrapClaudeCliJsonStdout`; all CLI adapters (claude, codex, cursor, opencode) and Ollama use this module for consistent JSON extraction and validation. Bump `PROMPT_VERSION` when the analysis JSON schema or prompts change.

### Dependencies

- `xstate`, `@xstate/react` — pipeline phase state machine for the Ink UI.

## [0.1.0.0] - 2026-04-03 — First Light

Scan your local project directories, let AI understand what each project is, and generate a technical CV as a starting draft. The tool that captures the 80% of your work history that GitHub never sees.

### Added

- **`agent-cv scan <directory>`** — Discover projects by filesystem markers (package.json, Cargo.toml, go.mod, and 15 others). Extracts dates from git history, detects language and frameworks, identifies TypeScript/React/Express/Vue/Angular automatically. Skips node_modules, .git, dist, and other noise directories.
- **`agent-cv analyze <project-path>`** — Delegate project analysis to Claude Code via stdin piping (no shell history leak). Parses structured JSON response with summary, tech stack, and key contributions. Validates non-empty output, retries on malformed responses.
- **`agent-cv generate <directory>`** — Full flow: scan, select projects, analyze each with AI, render markdown CV. Supports `--dry-run` to preview what would be sent to the LLM without spending tokens. Supports `--output` for file output.
- **Privacy audit** — Before any LLM analysis, scans for .env files, API keys, private keys, and hardcoded secrets. Excluded files never reach the AI. Warning printed with count.
- **Persistent inventory** — Project data saved to `~/.agent-cv/inventory.json`. Re-runs pick up where they left off (cached analyses survive between sessions). Atomic writes via temp file + rename prevent corruption on Ctrl+C.
- **Nested project dedup** — Monorepos with multiple package.json files at different depths are detected once at the shallowest marker. No double-counting.
- **Plugin architecture** — AgentAdapter and OutputRenderer interfaces defined. Claude Code adapter and markdown renderer are the v0a implementations. Ready for Codex, API fallback, and JSON Resume renderers.
- **6 tests** covering scanner (happy path, empty dir, missing dir, multiple projects, Python detection, secrets detection).
