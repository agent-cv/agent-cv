import { assign, fromPromise, setup } from "xstate";
import { resolve } from "node:path";
import { readInventory } from "@agent-cv/core/src/inventory/store.ts";
import { scanAndMerge } from "@agent-cv/core/src/pipeline.ts";
import type { Project } from "@agent-cv/core/src/types.ts";

export type DiffResult = {
  added: Project[];
  removed: Project[];
  updated: Array<{ project: Project; newCommits: number }>;
  unchanged: number;
};

export type DiffFlowInput = {
  directory: string;
};

type Ctx = {
  directory: string;
  error: string;
  result: DiffResult | null;
};

async function computeDiff(directory: string): Promise<DiffResult> {
  const absDir = resolve(directory);
  const oldInventory = await readInventory();
  const existingByPath = new Map(
    oldInventory.projects.filter((p) => p.path.startsWith(absDir)).map((p) => [p.path, p])
  );
  const { projects: scannedProjects } = await scanAndMerge(directory);
  const scannedByPath = new Map(scannedProjects.map((p) => [p.path, p]));

  const added: Project[] = [];
  const removed: Project[] = [];
  const updated: Array<{ project: Project; newCommits: number }> = [];
  let unchanged = 0;

  for (const [path, project] of scannedByPath) {
    const existing = existingByPath.get(path);
    if (!existing) {
      added.push(project);
    } else {
      const commitDelta = project.commitCount - existing.commitCount;
      if (commitDelta > 0) {
        updated.push({ project, newCommits: commitDelta });
      } else {
        unchanged++;
      }
    }
  }

  for (const [path, project] of existingByPath) {
    if (!scannedByPath.has(path) && !project.tags.includes("removed")) {
      removed.push(project);
    }
  }

  return { added, removed, updated, unchanged };
}

const runDiffActor = fromPromise(async ({ input }: { input: { directory: string } }) => {
  return computeDiff(input.directory);
});

export const diffFlowMachine = setup({
  types: {
    context: {} as Ctx,
    events: {} as { type: never },
    input: {} as DiffFlowInput,
  },
  actors: { runDiff: runDiffActor },
}).createMachine({
  id: "diffFlow",
  context: ({ input }) => ({
    directory: input.directory,
    error: "",
    result: null,
  }),
  initial: "running",
  states: {
    running: {
      invoke: {
        src: "runDiff",
        input: ({ context }) => ({ directory: context.directory }),
        onDone: {
          target: "success",
          actions: assign({
            result: ({ event }) => event.output as DiffResult,
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
