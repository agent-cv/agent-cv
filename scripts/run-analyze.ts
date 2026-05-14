#!/usr/bin/env bun
/**
 * Headless project analysis runner. Bypasses Ink so we can run long batches
 * (e.g. 557 projects) in nohup-background without TTY / Bun-Ink crashes.
 *
 * Picks up the existing inventory, finds unanalyzed projects, runs the
 * configured Ollama adapter, writes inventory back after each batch.
 *
 * Usage:
 *   bun scripts/run-analyze.ts                 # ollama, all unanalyzed
 *   bun scripts/run-analyze.ts --limit 50      # cap for smoke test
 *   bun scripts/run-analyze.ts --concurrency 1 # override pipeline batch size
 */
import { readInventory, writeInventory } from "../packages/core/src/inventory/store.ts";
import { analyzeProjects } from "../packages/core/src/pipeline/analyze.ts";
import { OllamaAdapter } from "../packages/core/src/analysis/adapters/ollama-adapter.ts";

type Args = { limit?: number; concurrency?: number };

function parseArgs(argv: string[]): Args {
  const out: Args = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const n = argv[i + 1];
    if (a === "--limit" && n) {
      out.limit = Number(n);
      i++;
    } else if (a === "--concurrency" && n) {
      out.concurrency = Number(n);
      i++;
    }
  }
  return out;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const startedAt = Date.now();

  console.error("> reading inventory...");
  const inv = await readInventory();
  if (inv.projects.length === 0) {
    console.error("error: inventory empty — run scan first via the CLI");
    process.exit(1);
  }
  console.error(`> inventory: ${inv.projects.length} projects total`);

  const adapter = new OllamaAdapter();
  const available = await adapter.isAvailable();
  if (!available) {
    console.error("error: Ollama not reachable at " + (process.env.OLLAMA_HOST || "http://localhost:11434"));
    process.exit(1);
  }
  console.error(`> ollama model: ${adapter.getModel()}, maxConcurrency=${adapter.maxConcurrency}`);

  // Pass all included projects to analyzeProjects — it checks PROMPT_VERSION,
  // lastCommit, and analysis presence to decide what to (re)analyze. Limiting
  // here to only `!p.analysis` previously masked PROMPT_VERSION bumps.
  let queue = inv.projects.filter((p) => p.included !== false);
  const stale = queue.filter((p) => !p.analysis || p.analysis.promptVersion !== "4").length;
  console.error(`> included: ${queue.length}; needs reanalyze (no analysis or stale prompt version): ${stale}`);
  if (args.limit) {
    queue = queue.slice(0, args.limit);
    console.error(`> capped to first ${queue.length} by --limit`);
  }
  if (queue.length === 0) {
    console.error("nothing to do");
    process.exit(0);
  }

  let done = 0;
  let failed = 0;
  let lastReport = Date.now();

  await analyzeProjects(queue, adapter, inv, {
    concurrency: args.concurrency,
    onProgress: (completed, total, current) => {
      const now = Date.now();
      if (now - lastReport < 4000 && completed !== total) return;
      lastReport = now;
      const elapsed = ((now - startedAt) / 1000).toFixed(0);
      const rate = completed > 0 ? (completed / (now - startedAt)) * 1000 : 0;
      const eta = rate > 0 ? Math.round((total - completed) / rate) : 0;
      console.error(
        `> [${completed}/${total}] ${elapsed}s elapsed, ETA ${eta}s — ${current.slice(0, 60)}`
      );
    },
    onProjectStatus: (id, status, detail) => {
      if (status === "done") done++;
      else if (status === "failed") {
        failed++;
        console.error(`! fail ${id}: ${detail ?? ""}`);
      }
    },
  });

  const elapsedMin = ((Date.now() - startedAt) / 60000).toFixed(1);
  console.error(`\n> finished in ${elapsedMin} min. done=${done} failed=${failed}`);

  // Final inventory write (analyzeProjects already writes per batch, but be explicit).
  await writeInventory(inv);
  console.error(`> inventory persisted`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
