# @agent-cv/core

Headless library code for **agent-cv**: types, pipeline orchestration, filesystem/GitHub discovery, inventory I/O, AI adapters, markdown output, and telemetry helpers.

This package is **workspace-private** (`"private": true`). The published npm artifact remains the **`agent-cv`** CLI; core is not published on its own.

## Layer boundaries

Imports should generally flow **down** this list (higher layers depend on lower ones, not the reverse):

| Area | Path | Role |
|------|------|------|
| **Contracts** | `types.ts` | Shared data shapes (`Project`, `Inventory`, `PublishedPackage`, …). No imports from discovery/analysis except other pure types. |
| **Session & disk (local)** | `auth/` | JWT device flow, API publish/unpublish, saved API credentials (`auth/credentials.ts`). Depends on `data-dir.ts` only for paths. |
| **Paths** | `data-dir.ts` | Config directory resolution (used by auth, telemetry, inventory). |
| **Pipeline** | `pipeline.ts`, `pipeline/` | Orchestration: scan → merge → analyze → optional GitHub cloud phase. Calls discovery, analysis, inventory. |
| **Discovery** | `discovery/` | Scanning repos, GitHub API, privacy, remote grouping, **package registries** (implements search; types like `PublishedPackage` live in `types.ts`). |
| **Insights** | `insights/` | Profile narrative: yearly engagement rules (`project-engagement.ts`) + LLM-driven bio/highlights (`bio-generator.ts`). |
| **Analysis** | `analysis/` | Context building, cloud context, **adapters** (`analysis/adapters/*`), API parsing (`api-parse.ts`). |
| **Inventory** | `inventory/` | Zod schema + read/write merge layer for cached scan results. |
| **Output** | `output/` | Markdown rendering. |
| **Telemetry** | `telemetry.ts` | Opt-in usage events; uses `data-dir`. |

**Adapters:** `analysis/adapters/resolve-adapter.ts` and `*-adapter.ts`; shared HTTP/JSON parsing stays in `analysis/api-parse.ts`.

## Imports

From the repo root or CLI package, use explicit subpaths, for example:

- `@agent-cv/core/src/types.ts`
- `@agent-cv/core/src/pipeline.ts`
- `@agent-cv/core/src/inventory/store.ts`
- `@agent-cv/core/src/auth/index.ts` — device flow and publish API
- `@agent-cv/core/src/auth/credentials.ts` — saved LLM/API keys (optional)
- `@agent-cv/core/src/insights/bio-generator.ts` — profile insights orchestration
- `@agent-cv/core/src/analysis/adapters/resolve-adapter.ts` — agent implementations (`*-adapter.ts`) live under `analysis/adapters/`; shared parsing stays in `analysis/api-parse.ts`.

There is no single public `exports` map yet; paths mirror `packages/core/src/`.

## Dependencies

Declared in this package’s `package.json` (`zod`, `simple-git`, `posthog-node`). The CLI app depends on `@agent-cv/core` via `workspace:*`.
