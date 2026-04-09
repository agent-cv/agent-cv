# Contributing to agent-cv

## Prerequisites

- [Bun](https://bun.sh) (matches runtime used by the CLI and tests)

## Setup

```bash
git clone <repository-url>
cd agent-cv
bun install
```

## Commands

| Command | Purpose |
|--------|---------|
| `bun run dev` | Run the CLI from source (`src/cli.ts`) |
| `bun test` | Run the full test suite from the repo root |
| `bun run build:npm` | Produce `dist/cli.js` for npm packaging |

CI runs the same test suite on push/PR to `main` or `master` (see `.github/workflows/test.yml`).

## Repository layout

- **`src/`** — CLI entrypoint (`cli.ts`), per-command folders (`commands/<name>/`), and UI (`components/`).
- **`packages/core/`** — Workspace package **`@agent-cv/core`**: pipeline, discovery, inventory, analysis adapters, telemetry, and publish helpers. Import with subpaths such as `@agent-cv/core/src/pipeline.ts` or `@agent-cv/core/src/types.ts` (workspace-only; not published to npm separately yet).

Keep new headless logic in **`packages/core`**; keep Ink/React in **`src/`**.

## CLI architecture (state)

Three layers are intentional; do not collapse them:

1. **`packages/core` auth** — `ensureAuth`, `runDeviceFlowPoll`, `getAgentCvApiUrl`, HTTP helpers. No Ink.
2. **Commands** — XState machines in `src/commands/<command>/<command>.machine.ts` (Ink entry in the same folder). Orchestrate auth UI, pipeline, and publish/unpublish side effects via events (`AUTH_OK`, `PIPELINE_DONE`, …).
3. **Pipeline** — `src/pipeline/phase-machine.ts` (`pipelinePhaseMachine`) drives scan/analyze phases inside `Pipeline.tsx`. In that component, `setPhase` is a thin adapter over `send(...)` to the pipeline machine, not a second parallel `useState` phase list.

Shared GitHub device sign-in UI lives in `src/components/AuthGate.tsx`. During polling you can cancel with **`q`** or **Ctrl+C** (SIGINT). API base URL for publish/auth/unpublish is **`AGENT_CV_API_URL`** (default `https://agent-cv.dev`, no trailing slash).

More detail: **[`src/commands/README.md`](src/commands/README.md)** (command → machine map, ASCII data flow, shared event names). Command-level integration tests for state machines: [`test/command-flows.test.ts`](test/command-flows.test.ts).

Shared Ink hooks used by multiple commands: [`src/hooks/useInkTerminalExit.ts`](src/hooks/useInkTerminalExit.ts) (exit + process code after a terminal state), [`src/hooks/useClearAuthOnSessionExpired.ts`](src/hooks/useClearAuthOnSessionExpired.ts) (clear stored JWT on session-expired errors).
