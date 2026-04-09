import { assign, fromPromise, setup } from "xstate";
import { readInventory } from "@agent-cv/core/src/inventory/store.ts";
import { publishToApi, type AuthToken } from "@agent-cv/core/src/auth/index.ts";
import { sanitizeForPublish } from "@agent-cv/core/src/publish.ts";
import type { Inventory, Project } from "@agent-cv/core/src/types.ts";
import type { PipelineResult } from "../../components/Pipeline.tsx";

export type PublishFlowOptions = {
  bio?: string;
  noOpen?: boolean;
  all?: boolean;
  agent?: string;
  email?: string;
  yes?: boolean;
};

export type PublishFlowInput = {
  directory?: string;
  options: PublishFlowOptions;
};

type Ctx = {
  error: string;
  jwt: string;
  directory?: string;
  options: PublishFlowOptions;
  inventory: Inventory | null;
  selectedProjects: Project[];
  totalCount: number;
  publicCount: number;
  analyzedCount: number;
  resultUrl: string;
};

const loadCacheActor = fromPromise(async () => {
  const inv = await readInventory();
  if (inv.projects.length === 0) {
    throw new Error("No projects found. Run `agent-cv generate ~/Projects` first.");
  }
  if (!inv.insights?.bio && !inv.insights?._fingerprint) {
    throw new Error("No insights generated yet. Run `agent-cv generate ~/Projects` first to analyze projects.");
  }
  const projects = inv.projects.filter((p) => !p.tags.includes("removed") && p.included !== false);
  return { inventory: inv, projects };
});

const publishActor = fromPromise(
  async ({
    input,
  }: {
    input: { jwt: string; inventory: Inventory; bio?: string };
  }) => {
    const payload = sanitizeForPublish(input.inventory, input.bio);
    return publishToApi(input.jwt, payload);
  }
);

export const publishFlowMachine = setup({
  types: {
    context: {} as Ctx,
    events: {} as
      | { type: "AUTH_OK"; token: AuthToken }
      | { type: "AUTH_FAIL"; message: string }
      | { type: "PIPELINE_DONE"; result: PipelineResult }
      | { type: "PIPELINE_ERROR"; message: string }
      | { type: "CONFIRM" }
      | { type: "CANCEL" },
    input: {} as PublishFlowInput,
  },
  actors: {
    loadCache: loadCacheActor,
    publishToApi: publishActor,
  },
  guards: {
    hasDirectory: ({ context }) => Boolean(context.directory?.length),
    skipConfirm: ({ context }) => Boolean(context.options.yes),
  },
}).createMachine({
  id: "publishFlow",
  context: ({ input }) => ({
    error: "",
    jwt: "",
    directory: input.directory,
    options: input.options,
    inventory: null,
    selectedProjects: [],
    totalCount: 0,
    publicCount: 0,
    analyzedCount: 0,
    resultUrl: "",
  }),
  initial: "awaitingAuth",
  states: {
    awaitingAuth: {
      on: {
        AUTH_OK: {
          target: "routeAfterAuth",
          actions: assign({ jwt: ({ event }) => event.token.jwt, error: () => "" }),
        },
        AUTH_FAIL: { target: "failed", actions: assign({ error: ({ event }) => event.message }) },
      },
    },
    routeAfterAuth: {
      always: [
        { guard: "hasDirectory", target: "runningPipeline" },
        { target: "loadingCache" },
      ],
    },
    runningPipeline: {
      on: {
        PIPELINE_DONE: {
          target: "checkingPublic",
          actions: assign({
            inventory: ({ event }) => event.result.inventory,
            selectedProjects: ({ event }) => event.result.projects,
            error: () => "",
          }),
        },
        PIPELINE_ERROR: {
          target: "failed",
          actions: assign({ error: ({ event }) => event.message }),
        },
      },
    },
    loadingCache: {
      invoke: {
        src: "loadCache",
        onDone: {
          target: "checkingPublic",
          actions: assign({
            inventory: ({ event }) => event.output.inventory,
            selectedProjects: ({ event }) => event.output.projects,
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
    checkingPublic: {
      entry: assign({
        totalCount: ({ context }) => context.selectedProjects.length,
        publicCount: ({ context }) => context.selectedProjects.filter((p) => p.isPublic).length,
        analyzedCount: ({ context }) => context.selectedProjects.filter((p) => p.analysis).length,
      }),
      always: [
        { guard: "skipConfirm", target: "publishing" },
        { target: "confirming" },
      ],
    },
    confirming: {
      on: {
        CONFIRM: { target: "publishing" },
        CANCEL: { target: "failed", actions: assign({ error: () => "Cancelled." }) },
      },
    },
    publishing: {
      invoke: {
        src: "publishToApi",
        input: ({ context }) => ({
          jwt: context.jwt,
          inventory: context.inventory!,
          bio: context.options.bio,
        }),
        onDone: {
          target: "done",
          actions: assign({
            resultUrl: ({ event }) => {
              const out = event.output as { url: string };
              return out.url.replace(/\n/g, "").trim();
            },
          }),
        },
        onError: {
          target: "failed",
          actions: assign({
            error: ({ event }) => {
              const err = (event as unknown as { error?: unknown }).error;
              const msg = err instanceof Error ? err.message : String(err);
              if (msg === "AUTH_EXPIRED") {
                return "Session expired. Run `agent-cv publish` again.";
              }
              return msg;
            },
          }),
        },
      },
    },
    done: { type: "final" },
    failed: { type: "final" },
  },
});
