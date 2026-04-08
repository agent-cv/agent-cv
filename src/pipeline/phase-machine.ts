import { assign, fromPromise, setup } from "xstate";

/** UI phases for the generate/publish pipeline (order is not the state graph). */
export const PIPELINE_PHASES = [
  "init",
  "scanning",
  "picking-emails",
  "recounting",
  "selecting",
  "picking-agent",
  "analyzing",
  "analysis-failed",
  "finishing",
  "done",
] as const;

export type Phase = (typeof PIPELINE_PHASES)[number];

/**
 * Allowed directed transitions (invalid sends are ignored by the machine).
 * Keep in sync with setPhase / flow in Pipeline.tsx.
 */
export const PIPELINE_PHASE_EDGES: readonly (readonly [Phase, Phase])[] = [
  ["init", "scanning"],
  ["scanning", "recounting"],
  ["scanning", "picking-emails"],
  ["scanning", "selecting"],
  ["picking-emails", "recounting"],
  ["recounting", "picking-agent"],
  ["recounting", "analyzing"],
  ["recounting", "selecting"],
  ["selecting", "analyzing"],
  ["selecting", "picking-agent"],
  ["picking-agent", "analyzing"],
  ["picking-agent", "selecting"],
  ["analyzing", "analysis-failed"],
  ["analyzing", "finishing"],
  ["analysis-failed", "analyzing"],
  ["analysis-failed", "finishing"],
  ["analysis-failed", "picking-agent"],
  ["finishing", "done"],
];

/** `markNoticeSeen()` returns true if the user was already prompted. */
export type PipelineBootstrapResult = { alreadySeen: boolean };

export type PipelinePhaseMachineInput = {
  /** Run once while in `init` (e.g. telemetry notice + persist prompt state). */
  bootstrap: () => Promise<PipelineBootstrapResult>;
};

/** Used when `createActor` / tests omit `input` (skip telemetry banner). */
export async function defaultPipelineBootstrap(): Promise<PipelineBootstrapResult> {
  return { alreadySeen: true };
}

type PipelinePhaseContext = {
  showTelemetryNotice: boolean;
  bootstrap: PipelinePhaseMachineInput["bootstrap"];
};

function eventTypeForTarget(to: Phase): string {
  return `GOTO_${to.replace(/-/g, "_").toUpperCase()}`;
}

/** Event object to send for a phase transition (matches edges in pipelinePhaseMachine). */
export function gotoPhaseEvent(to: Phase): { type: string } {
  return { type: eventTypeForTarget(to) };
}

function buildGotoOnlyStates(): Record<string, { on: Record<string, { target: string }> }> {
  const states: Record<string, { on: Record<string, { target: string }> }> = {};
  for (const p of PIPELINE_PHASES) {
    if (p === "init") continue;
    states[p] = { on: {} };
  }
  for (const [from, to] of PIPELINE_PHASE_EDGES) {
    if (from === "init") continue;
    states[from]!.on[eventTypeForTarget(to)] = { target: to };
  }
  return states;
}

const bootstrapActor = fromPromise(
  async ({ input }: { input: { run: () => Promise<PipelineBootstrapResult> } }) => input.run()
);

/** Safe for malformed actor output — default: no banner. */
function showTelemetryNoticeFromBootstrapOutput(output: unknown): boolean {
  if (output !== null && typeof output === "object" && "alreadySeen" in output) {
    const v = (output as { alreadySeen?: unknown }).alreadySeen;
    if (typeof v === "boolean") return !v;
  }
  return false;
}

export const pipelinePhaseMachine = setup({
  types: {
    input: {} as PipelinePhaseMachineInput | undefined,
    context: {} as PipelinePhaseContext,
    events: {} as { type: string },
  },
  actors: {
    bootstrap: bootstrapActor,
  },
}).createMachine({
  id: "pipelinePhase",
  context: ({ input }): PipelinePhaseContext => ({
    showTelemetryNotice: false,
    bootstrap: input?.bootstrap ?? defaultPipelineBootstrap,
  }),
  initial: "init",
  states: {
    init: {
      invoke: {
        src: "bootstrap",
        input: ({ context }) => ({ run: context.bootstrap }),
        onDone: {
          target: "scanning",
          actions: assign({
            showTelemetryNotice: ({ event }) => showTelemetryNoticeFromBootstrapOutput(event.output),
          }),
        },
        onError: {
          target: "scanning",
          actions: assign({ showTelemetryNotice: false }),
        },
      },
      // Manual transition (tests, or skipping async bootstrap) cancels the invoke.
      on: {
        [eventTypeForTarget("scanning")]: {
          target: "scanning",
          actions: assign({ showTelemetryNotice: false }),
        },
      },
    },
    ...buildGotoOnlyStates(),
  },
});

export function isValidPhaseTransition(from: Phase, to: Phase): boolean {
  return PIPELINE_PHASE_EDGES.some(([a, b]) => a === from && b === to);
}
