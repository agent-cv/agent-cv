import { describe, expect, test } from "bun:test";
import { createActor, waitFor } from "xstate";
import {
  pipelinePhaseMachine,
  gotoPhaseEvent,
  PIPELINE_PHASE_EDGES,
  isValidPhaseTransition,
  defaultPipelineBootstrap,
  type Phase,
} from "../src/pipeline/phase-machine.ts";

const testInput = { input: { bootstrap: defaultPipelineBootstrap } } as const;

function sendPath(actor: ReturnType<typeof createActor<typeof pipelinePhaseMachine>>, phases: Phase[]) {
  for (const p of phases) {
    actor.send(gotoPhaseEvent(p));
  }
}

describe("pipelinePhaseMachine", () => {
  test("bootstrap assigns showTelemetryNotice when first run", async () => {
    const actor = createActor(pipelinePhaseMachine, {
      input: {
        bootstrap: async () => ({ alreadySeen: false }),
      },
    });
    actor.start();
    await waitFor(actor, (s) => s.matches("scanning"));
    expect(actor.getSnapshot().context.showTelemetryNotice).toBe(true);
  });

  test("default bootstrap skips telemetry banner", async () => {
    const actor = createActor(pipelinePhaseMachine, testInput);
    actor.start();
    await waitFor(actor, (s) => s.matches("scanning"));
    expect(actor.getSnapshot().context.showTelemetryNotice).toBe(false);
  });

  test("bootstrap with malformed output shows no banner", async () => {
    const actor = createActor(pipelinePhaseMachine, {
      input: {
        bootstrap: async () => ({}) as { alreadySeen: boolean },
      },
    });
    actor.start();
    await waitFor(actor, (s) => s.matches("scanning"));
    expect(actor.getSnapshot().context.showTelemetryNotice).toBe(false);
  });

  test("bootstrap failure still reaches scanning with no banner", async () => {
    const actor = createActor(pipelinePhaseMachine, {
      input: {
        bootstrap: async () => {
          throw new Error("bootstrap failed");
        },
      },
    });
    actor.start();
    await waitFor(actor, (s) => s.matches("scanning"));
    expect(actor.getSnapshot().context.showTelemetryNotice).toBe(false);
  });

  test("GOTO_SCANNING cancels slow bootstrap and clears banner", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const actor = createActor(pipelinePhaseMachine, {
      input: {
        bootstrap: async () => {
          await gate;
          return { alreadySeen: false };
        },
      },
    });
    actor.start();
    expect(actor.getSnapshot().matches("init")).toBe(true);
    actor.send(gotoPhaseEvent("scanning"));
    await waitFor(actor, (s) => s.matches("scanning"));
    expect(actor.getSnapshot().context.showTelemetryNotice).toBe(false);
    release();
    await gate.catch(() => {
      /* invoke may cancel the awaited gate; completion is harmless */
    });
  });

  test("follows a typical happy path", async () => {
    const actor = createActor(pipelinePhaseMachine, testInput);
    actor.start();
    actor.send(gotoPhaseEvent("scanning"));
    await waitFor(actor, (s) => s.matches("scanning"));
    sendPath(actor, ["picking-emails", "recounting", "selecting", "picking-agent", "analyzing", "finishing", "done"]);
    expect(actor.getSnapshot().value).toBe("done");
  });

  test("ignores invalid transition (stays in scanning)", async () => {
    const actor = createActor(pipelinePhaseMachine, testInput);
    actor.start();
    await waitFor(actor, (s) => s.matches("scanning"));
    actor.send(gotoPhaseEvent("done"));
    expect(actor.getSnapshot().value).toBe("scanning");
  });

  test("analysis-failed can go to analyzing, finishing, or picking-agent", async () => {
    const actor = createActor(pipelinePhaseMachine, testInput);
    actor.start();
    await waitFor(actor, (s) => s.matches("scanning"));
    sendPath(actor, ["recounting", "analyzing", "analysis-failed"]);
    expect(actor.getSnapshot().value).toBe("analysis-failed");

    actor.send(gotoPhaseEvent("analyzing"));
    expect(actor.getSnapshot().value).toBe("analyzing");

    actor.send(gotoPhaseEvent("analysis-failed"));
    actor.send(gotoPhaseEvent("finishing"));
    expect(actor.getSnapshot().value).toBe("finishing");

    const b = createActor(pipelinePhaseMachine, testInput);
    b.start();
    await waitFor(b, (s) => s.matches("scanning"));
    sendPath(b, ["recounting", "analyzing", "analysis-failed"]);
    b.send(gotoPhaseEvent("picking-agent"));
    expect(b.getSnapshot().value).toBe("picking-agent");
  });
});

describe("isValidPhaseTransition", () => {
  test("edges match declared list", () => {
    for (const [from, to] of PIPELINE_PHASE_EDGES) {
      expect(isValidPhaseTransition(from, to)).toBe(true);
    }
    expect(isValidPhaseTransition("scanning", "done")).toBe(false);
    expect(isValidPhaseTransition("done", "init")).toBe(false);
  });
});
