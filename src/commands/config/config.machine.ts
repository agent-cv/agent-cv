import { assign, fromPromise, setup } from "xstate";
import { readInventory, writeInventory } from "@agent-cv/core/src/inventory/store.ts";
import { isTelemetryEnabled, setTelemetryEnabled } from "@agent-cv/core/src/telemetry.ts";
import type { Inventory } from "@agent-cv/core/src/types.ts";
import {
  applyConfigFieldCommit,
  buildConfigFields,
  type ConfigKeyEvent,
} from "./fields.ts";

export type ConfigFlowInput = Record<string, never>;

type Ctx = {
  inventory: Inventory | null;
  telemetry: boolean | null;
  cursor: number;
  editing: boolean;
  editValue: string;
  saved: boolean;
  error: string;
  pendingTelemetry?: boolean;
  /** When editing the telemetry row, only persist telemetry flag (matches legacy behavior). */
  telemetryCommitOnly?: boolean;
};

const bootstrapActor = fromPromise(async () => {
  const [inventory, telemetry] = await Promise.all([
    readInventory(),
    isTelemetryEnabled(),
  ]);
  return { inventory, telemetry };
});

const persistActor = fromPromise(
  async ({
    input,
  }: {
    input: {
      inventory: Inventory;
      telemetryEnabled?: boolean;
      telemetryCommitOnly?: boolean;
    };
  }) => {
    if (input.telemetryCommitOnly) {
      if (input.telemetryEnabled !== undefined) {
        await setTelemetryEnabled(input.telemetryEnabled);
      }
      return;
    }
    await writeInventory(input.inventory);
    if (input.telemetryEnabled !== undefined) {
      await setTelemetryEnabled(input.telemetryEnabled);
    }
  }
);

function fieldsFor(ctx: Ctx) {
  if (ctx.inventory === null || ctx.telemetry === null) return [];
  return buildConfigFields(ctx.inventory, ctx.telemetry);
}

export type ConfigFlowEvent =
  | { type: "INPUT"; input: string; key: ConfigKeyEvent }
  | { type: "CLEAR_SAVED" };

export const configFlowMachine = setup({
  types: {
    context: {} as Ctx,
    events: {} as ConfigFlowEvent,
    input: {} as ConfigFlowInput,
  },
  actors: {
    bootstrap: bootstrapActor,
    persist: persistActor,
  },
}).createMachine({
  id: "configFlow",
  context: {
    inventory: null,
    telemetry: null,
    cursor: 0,
    editing: false,
    editValue: "",
    saved: false,
    error: "",
  },
  initial: "loading",
  states: {
    loading: {
      invoke: {
        src: "bootstrap",
        onDone: {
          target: "ready",
          actions: assign({
            inventory: ({ event }) => (event.output as { inventory: Inventory }).inventory,
            telemetry: ({ event }) => (event.output as { telemetry: boolean }).telemetry,
            error: () => "",
          }),
        },
        onError: {
          target: "failed",
          actions: assign({
            error: ({ event }) => {
              const err = (event as unknown as { error?: unknown }).error;
              return err instanceof Error ? err.message : String(err);
            },
          }),
        },
      },
    },
    ready: {
      initial: "idle",
      states: {
        idle: {
          on: {
            INPUT: [
              {
                guard: ({ context, event }) =>
                  Boolean(
                    context.inventory &&
                      context.telemetry !== null &&
                      !context.editing &&
                      (event.input === "q" || event.key.escape)
                  ),
                target: "#configFlow.exited",
              },
              {
                guard: ({ context, event }) =>
                  Boolean(context.inventory && context.telemetry !== null && context.editing && event.key.return),
                target: "persisting",
                actions: assign(({ context }) => {
                  const fields = fieldsFor(context);
                  const field = fields[context.cursor]!;
                  const { inventory, telemetryEnabled } = applyConfigFieldCommit(
                    context.inventory!,
                    field,
                    context.editValue
                  );
                  return {
                    inventory,
                    pendingTelemetry: telemetryEnabled,
                    telemetryCommitOnly: field.key === "telemetry",
                    editing: false,
                    editValue: "",
                  };
                }),
              },
              {
                guard: ({ context, event }) =>
                  Boolean(context.inventory && context.editing && event.key.escape),
                actions: assign({ editing: () => false }),
              },
              {
                guard: ({ context, event }) =>
                  Boolean(
                    context.inventory &&
                      context.telemetry !== null &&
                      context.editing &&
                      (event.key.backspace === true || event.key.delete === true)
                  ),
                actions: assign({
                  editValue: ({ context }) => context.editValue.slice(0, -1),
                }),
              },
              {
                guard: ({ context, event }) =>
                  Boolean(
                    context.inventory &&
                      context.telemetry !== null &&
                      context.editing &&
                      Boolean(event.input) &&
                      !event.key.return &&
                      !event.key.ctrl &&
                      !event.key.meta
                  ),
                actions: assign({
                  editValue: ({ context, event }) => context.editValue + event.input,
                }),
              },
              {
                guard: ({ context, event }) =>
                  Boolean(
                    context.inventory &&
                      context.telemetry !== null &&
                      !context.editing &&
                      event.key.upArrow === true
                  ),
                actions: assign({
                  cursor: ({ context }) => {
                    const n = fieldsFor(context).length;
                    return context.cursor > 0 ? context.cursor - 1 : Math.max(0, n - 1);
                  },
                }),
              },
              {
                guard: ({ context, event }) =>
                  Boolean(
                    context.inventory &&
                      context.telemetry !== null &&
                      !context.editing &&
                      event.key.downArrow === true
                  ),
                actions: assign({
                  cursor: ({ context }) => {
                    const n = fieldsFor(context).length;
                    return context.cursor < n - 1 ? context.cursor + 1 : 0;
                  },
                }),
              },
              {
                guard: ({ context, event }) =>
                  Boolean(
                    context.inventory &&
                      context.telemetry !== null &&
                      !context.editing &&
                      event.key.return === true
                  ),
                actions: assign(({ context }) => {
                  const fields = fieldsFor(context);
                  const field = fields[context.cursor]!;
                  const start =
                    field.value === "(auto-generated on next run)" ? "" : field.value;
                  return { editing: true, editValue: start };
                }),
              },
            ],
            CLEAR_SAVED: {
              actions: assign({ saved: () => false }),
            },
          },
        },
        persisting: {
          invoke: {
            src: "persist",
            input: ({ context }) => ({
              inventory: context.inventory!,
              telemetryEnabled: context.pendingTelemetry,
              telemetryCommitOnly: context.telemetryCommitOnly,
            }),
            onDone: {
              target: "idle",
              actions: assign({
                saved: () => true,
                telemetry: ({ context }) =>
                  context.pendingTelemetry !== undefined
                    ? context.pendingTelemetry
                    : context.telemetry,
                pendingTelemetry: () => undefined,
                telemetryCommitOnly: () => undefined,
              }),
            },
            onError: {
              target: "idle",
              actions: assign({
                error: ({ event }) => {
                  const err = (event as unknown as { error?: unknown }).error;
                  return err instanceof Error ? err.message : String(err);
                },
                pendingTelemetry: () => undefined,
                telemetryCommitOnly: () => undefined,
              }),
            },
          },
        },
      },
    },
    failed: { type: "final" },
    exited: { type: "final" },
  },
});
