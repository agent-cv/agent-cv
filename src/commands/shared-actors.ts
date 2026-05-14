import { fromPromise } from "xstate";
import { readInventory } from "@agent-cv/core/src/inventory/store.ts";

/**
 * Pick the most recent saved scan path from the inventory.
 *
 * Both `generate` and `publish` had identical inline copies of this with only
 * the usage-error text differing. The actor accepts a `commandName` in input
 * so each command surfaces the right `agent-cv <cmd> <dir>` hint.
 */
export const resolveScanPathActor = fromPromise(
  async ({ input }: { input: { commandName: string; freshHint?: boolean } }) => {
    const { commandName, freshHint = false } = input;
    const usage = freshHint
      ? `Usage: agent-cv ${commandName} <directory>\n   or: agent-cv ${commandName} --fresh <directory>`
      : `Usage: agent-cv ${commandName} <directory>`;
    let inv;
    try {
      inv = await readInventory();
    } catch {
      throw new Error(`No directory specified.\n${usage}`);
    }
    const paths = inv.scanPaths?.filter(Boolean) || [];
    if (paths.length === 0) {
      throw new Error(`No directory specified and no previous scan paths found.\n${usage}`);
    }
    const pick = paths.length === 1 ? paths[0]! : paths[paths.length - 1]!;
    return { directory: pick };
  }
);
