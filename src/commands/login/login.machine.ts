import { assign, setup } from "xstate";
import type { AuthToken } from "@agent-cv/core/src/auth/index.ts";

export const loginFlowMachine = setup({
  types: {
    context: {} as { error: string },
    events: {} as { type: "AUTH_OK"; token: AuthToken } | { type: "AUTH_FAIL"; message: string },
    input: {} as Record<string, never>,
  },
}).createMachine({
  id: "loginFlow",
  context: { error: "" },
  initial: "awaitingAuth",
  states: {
    awaitingAuth: {
      on: {
        AUTH_OK: { target: "done", actions: assign({ error: () => "" }) },
        AUTH_FAIL: { target: "failed", actions: assign({ error: ({ event }) => event.message }) },
      },
    },
    done: { type: "final" },
    failed: { type: "final" },
  },
});
