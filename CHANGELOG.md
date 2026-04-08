# Changelog

## [Unreleased]

### Changed

- **Monorepo:** Bun workspaces with headless code in `packages/core` (`@agent-cv/core`, workspace-private). CLI and Ink UI remain under `src/`; imports use `@agent-cv/core/src/...`.
- **Pipeline:** Phase transitions use `isValidPhaseTransition` + actor snapshot (no ref desync); clear-screen runs only after the machine actually enters an interactive phase; non-production warns on invalid `GOTO_*` sends.
- **CI (Phase E+):** `test.yml` runs tests then `bun run build:npm` (main/master, Bun 1.3.6, frozen lockfile, ignore-scripts); duplicate `ci.yml` removed to avoid double runs. Release job runs tests before build, pins Bun, uses frozen lockfile for npm publish and binary matrix builds.
- **Pipeline phase machine:** `setup()` + invoked `bootstrap` actor (`fromPromise`) for init telemetry; `showTelemetryNotice` lives on machine context; `GOTO_SCANNING` from `init` still cancels bootstrap (tests / manual skip). `defaultPipelineBootstrap` when `input` is omitted. Bootstrap `onError` clears the banner flag; `Pipeline` passes stable `useMemo` machine `input` to avoid actor re-init on render.
- **LLM JSON parsing:** Balanced-brace `extractFirstJsonObject` replaces greedy regex for structured analysis output.
- **Credentials file:** `credentials.json` is written with mode `0o600` where supported.

### Added

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
