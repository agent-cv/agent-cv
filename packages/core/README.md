# @agent-cv/core

Headless library code for **agent-cv**: types, pipeline orchestration, filesystem/GitHub discovery, inventory I/O, AI adapters, markdown output, and telemetry helpers.

This package is **workspace-private** (`"private": true`). The published npm artifact remains the **`agent-cv`** CLI; core is not published on its own.

## Imports

From the repo root or CLI package, use explicit subpaths, for example:

- `@agent-cv/core/src/types.ts`
- `@agent-cv/core/src/pipeline.ts`
- `@agent-cv/core/src/inventory/store.ts`

There is no single public `exports` map yet; paths mirror `packages/core/src/`.

## Dependencies

Declared in this package’s `package.json` (`zod`, `simple-git`, `posthog-node`). The CLI app depends on `@agent-cv/core` via `workspace:*`.
