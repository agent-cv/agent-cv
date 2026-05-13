#!/usr/bin/env bun
/**
 * Headless publish runner. Generates profile insights (bio, narrative, headline)
 * from the analyzed inventory, then syncs to agent-cv.dev via Bettersync.
 *
 * Run after scripts/run-analyze.ts has filled in project analyses. Bypasses Ink
 * so it works in nohup-background.
 */
import { readInventory, writeInventory } from "../packages/core/src/inventory/store.ts";
import { generateProfileInsights } from "../packages/core/src/insights/bio-generator.ts";
import { OllamaAdapter } from "../packages/core/src/analysis/adapters/ollama-adapter.ts";
import { publishViaSync } from "../packages/core/src/sync/publish.ts";

async function main() {
  const startedAt = Date.now();
  console.error("> reading inventory...");
  const inv = await readInventory();
  const analyzed = inv.projects.filter((p) => p.analysis).length;
  const total = inv.projects.length;
  console.error(`> ${analyzed}/${total} projects analyzed`);
  if (analyzed === 0) {
    console.error("error: no analyses found — run scripts/run-analyze.ts first");
    process.exit(1);
  }

  const adapter = new OllamaAdapter();
  if (!(await adapter.isAvailable())) {
    console.error("error: Ollama not reachable");
    process.exit(1);
  }
  console.error(`> ollama: ${adapter.getModel()}`);

  console.error("> generating insights (bio, narrative, yearly highlights)...");
  const insights = await generateProfileInsights(inv.projects, adapter, (step) => {
    console.error(`  ${step}`);
  });
  if (!insights) {
    console.error("error: insights generation returned null");
    process.exit(1);
  }
  inv.insights = insights;
  await writeInventory(inv);
  console.error(
    `> insights: bio=${insights.bio?.length ?? 0} chars, narrative=${insights.narrative?.length ?? 0} chars, yearly=${insights.yearlyInsights?.length ?? 0} years`
  );

  console.error("> publishing to agent-cv.dev...");
  const result = await publishViaSync(inv);
  const elapsed = ((Date.now() - startedAt) / 60000).toFixed(1);
  console.error(`> published in ${elapsed} min`);
  console.error(`> url: ${result.url}`);
}

main().catch((err) => {
  console.error("publish failed:", err);
  process.exit(1);
});
