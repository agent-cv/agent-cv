# Contributing to agent-cv

## Prerequisites

- [Bun](https://bun.sh) (matches runtime used by the CLI and tests)

## Setup

```bash
git clone <repository-url>
cd llm-cv
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

- **`src/`** — CLI entrypoint (`cli.ts`), Ink commands (`commands/`), and UI (`components/`).
- **`packages/core/`** — Workspace package **`@agent-cv/core`**: pipeline, discovery, inventory, analysis adapters, telemetry, and publish helpers. Import with subpaths such as `@agent-cv/core/src/pipeline.ts` or `@agent-cv/core/src/types.ts` (workspace-only; not published to npm separately yet).

Keep new headless logic in **`packages/core`**; keep Ink/React in **`src/`**.
