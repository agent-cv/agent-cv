import { assign, fromPromise, setup } from "xstate";
import { readInventory } from "@agent-cv/core/src/inventory/store.ts";
import { scanAndMerge } from "@agent-cv/core/src/pipeline.ts";
import type { Inventory } from "@agent-cv/core/src/types.ts";

export type StatsFlowInput = {
  directory?: string;
};

type Ctx = {
  directory?: string;
  error: string;
  inventory: Inventory | null;
};

const loadStatsActor = fromPromise(
  async ({ input }: { input: { directory?: string } }) => {
    if (input.directory) {
      const result = await scanAndMerge(input.directory);
      return { inventory: result.inventory };
    }
    const inv = await readInventory();
    if (inv.projects.length === 0) {
      throw new Error("No projects in inventory. Run `agent-cv generate ~/Projects` first.");
    }
    return { inventory: inv };
  }
);

export const statsFlowMachine = setup({
  types: {
    context: {} as Ctx,
    events: {} as { type: never },
    input: {} as StatsFlowInput,
  },
  actors: { loadStats: loadStatsActor },
}).createMachine({
  id: "statsFlow",
  context: ({ input }) => ({
    directory: input.directory,
    error: "",
    inventory: null,
  }),
  initial: "running",
  states: {
    running: {
      invoke: {
        src: "loadStats",
        input: ({ context }) => ({ directory: context.directory }),
        onDone: {
          target: "success",
          actions: assign({
            inventory: ({ event }) => (event.output as { inventory: Inventory }).inventory,
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
    success: { type: "final" },
    failed: { type: "final" },
  },
});
