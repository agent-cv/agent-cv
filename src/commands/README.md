# Commands (colocated)

Each CLI command has a folder under `src/commands/<name>/` with:

- **`<name>.tsx`** — Ink entry (`useMachine`, `AuthGate`, `Pipeline`, …)
- **`<name>.machine.ts`** — XState graph for that command
- **Helpers** next to the machine when command-specific (e.g. `config/fields.ts` + `fields.test.ts`)

Headless logic stays in `packages/core`.

## Where to start

1. Read **Contributing → CLI architecture** in the repo root [`CONTRIBUTING.md`](../../CONTRIBUTING.md).
2. Open the folder for the command you change (e.g. `generate/generate.machine.ts`).
3. Contract tests for transitions live in [`test/command-flows.test.ts`](../../test/command-flows.test.ts). Config field helpers: `config/fields.test.ts`.

## Command → machine → terminal states

| CLI command   | Folder / machine              | Final states (process exit)      |
|---------------|-------------------------------|----------------------------------|
| `generate`    | `generate/generate.machine.ts`   | `published`, `done`, `failed`   |
| `publish`     | `publish/publish.machine.ts`     | `done`, `failed`                 |
| `unpublish`   | `unpublish/unpublish.machine.ts` | `done`, `failed`                 |
| `login`       | `login/login.machine.ts`         | `done`, `failed`                 |
| `diff`        | `diff/diff.machine.ts`           | `success`, `failed`              |
| `stats`       | `stats/stats.machine.ts`         | `success`, `failed`              |
| `config`      | `config/config.machine.ts`       | `failed`, `exited` (quit)        |

## Data flow (high level)

```
src/cli.ts
    → commands/<name>/<name>.tsx  (Ink: AuthGate, Pipeline, useMachine)
          │
          ├─► @agent-cv/core (auth, inventory, publish HTTP)
          │
          └─► <name>.machine.ts  (XState: AUTH_*, PIPELINE_*, …)
                    │
                    ▼
              Pipeline.tsx  →  pipelinePhaseMachine  (scan / analyze phases only)
```

- **Command machine** decides: auth, when to run `Pipeline`, publish/unpublish side effects, confirmation prompts.
- **Pipeline machine** (`src/pipeline/phase-machine.ts`) only drives the long-running scan/analyze UI; it reports back via `onComplete` / `onError`, which commands map to `PIPELINE_DONE` / `PIPELINE_ERROR`.

## Shared events (vocabulary)

Events are declared on each machine’s `types.events`; common ones:

| Event | Typical sender | Meaning |
|--------|----------------|--------|
| `AUTH_OK` | `AuthGate` after device flow | JWT available; context updated |
| `AUTH_SKIPPED` | `AuthGate` when auth optional | Continue without JWT |
| `AUTH_FAIL` | `AuthGate` on fatal auth error | Usually → `failed` |
| `PIPELINE_DONE` | `Pipeline` `onComplete` | Inventory + projects ready |
| `PIPELINE_ERROR` | `Pipeline` `onError` | Message → usually `failed` |
| `CONFIRM` / `CANCEL` | `useInput` in command | Confirm/cancel publish prompts |
| `INPUT` / `CLEAR_SAVED` | `config` only | Keyboard line editing; clear “Saved!” toast |

Naming is consistent across commands so grepping the repo finds all wiring points.
