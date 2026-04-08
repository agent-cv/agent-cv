import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { generateProfileInsights } from "../src/lib/analysis/bio-generator.ts";
import { resolveAdapter } from "../src/lib/analysis/resolve-adapter.ts";

interface OpenRouterModel {
  name: string;
  costPerMillionTokens: number;
  description: string;
}

interface OpenRouterConfig {
  openrouter: {
    apiKey: string;
    models: Record<string, OpenRouterModel>;
  };
}

async function main() {
  const args = process.argv.slice(2);
  const specificModelKey = args[0];

  // Load inventory once to get project count
  const inventoryPath = resolve(process.cwd(), "inventory.json");
  const inventoryData = readFileSync(inventoryPath, "utf-8");
  const inventory = JSON.parse(inventoryData);
  const projectCount = inventory.projects.length;

  // Load OpenRouter config
  let openRouterConfig: OpenRouterConfig | null = null;
  try {
    const configPath = resolve(process.cwd(), "config/openrouter.json");
    openRouterConfig = JSON.parse(readFileSync(configPath, "utf-8")) as OpenRouterConfig;
  } catch (e) {
    console.warn("Could not load OpenRouter config; will fallback to default model.");
  }

  const modelsToRun: string[] = specificModelKey
    ? [specificModelKey]
    : openRouterConfig?.openrouter?.models
      ? Object.keys(openRouterConfig.openrouter.models)
      : ["claude-3-haiku"]; // fallback

  console.log(`Running insights generation for ${modelsToRun.length} model(s) on ${projectCount} projects...\n`);

  const results: Array<{
    model: string;
    modelId: string;
    costPerM: number;
    success: boolean;
    error?: string;
    insights?: any;
  }> = [];

  for (const modelKey of modelsToRun) {
    // Determine model ID for OpenRouter
    let modelId = modelKey; // fallback
    let costPerM = 0;
    let modelName = modelKey;
    if (openRouterConfig?.openrouter?.models?.[modelKey]) {
      const m = openRouterConfig.openrouter.models[modelKey];
      modelName = m.name;
      costPerM = m.costPerMillionTokens;
      // Construct prefixed model ID
      if (modelKey.startsWith("claude-")) {
        modelId = `anthropic/${modelKey}`;
      } else if (modelKey.startsWith("gpt-")) {
        modelId = `openai/${modelKey}`;
      } else if (modelKey.startsWith("gemini-")) {
        modelId = `google/${modelKey}`;
      }
      // else keep as is
    }

    // Set env vars for API adapter
    const openRouterKey = process.env.OPENROUTER_API_KEY;
    if (!openRouterKey) {
      console.error("Error: OPENROUTER_API_KEY environment variable is not set.");
      console.error("Get one at https://openrouter.ai/keys");
      process.exit(1);
    }
    process.env.AGENT_CV_API_KEY = openRouterKey;
    process.env.AGENT_CV_BASE_URL = "https://openrouter.ai/api/v1";
    process.env.AGENT_CV_MODEL = modelId;

    try {
      const { adapter } = await resolveAdapter('api');
      console.log(`Using model: ${modelId} (via OpenRouter)`);
      const resultInsights = await generateProfileInsights(
        inventory.projects,
        adapter,
        (step) => console.log(step)
      );
      results.push({
        model: modelName,
        modelId,
        costPerM: costPerM,
        success: true,
        insights: resultInsights,
      });
      // Always write per-model output file
      const outputPath = resolve(process.cwd(), `profile-insights-${modelKey}.json`);
      writeFileSync(outputPath, JSON.stringify(resultInsights, null, 2));
      console.log(`Saved profile insights to: ${outputPath}`);
      // If single model, also write to the default name for backward compatibility
      if (specificModelKey) {
        const defaultPath = resolve(process.cwd(), "profile-insights.json");
        writeFileSync(defaultPath, JSON.stringify(resultInsights, null, 2));
        console.log(`Also saved to: ${defaultPath}`);
      }
    } catch (err: any) {
      console.error(`Failed for model ${modelKey}: ${err.message}`);
      results.push({
        model: modelName,
        modelId,
        costPerM: costPerM,
        success: false,
        error: err.message,
      });
    }
    console.log(""); // blank line between models
  }

  // If we get here, we ran multiple models; print summary table
  if (!specificModelKey) {
    console.log("\n=== Cost Analysis Summary ===");
    console.log(`Projects: ${projectCount}`);
    console.log(
      "| Model | Cost per M tokens ($) | Est. tokens per project | Est. total tokens | Est. total cost ($) |"
    );
    console.log(
      "|-------|-----------------------|-------------------------|-------------------|---------------------|"
    );
    for (const r of results) {
      if (!r.success) continue;
      // Rough estimate: 4000 tokens per project (adjust as needed)
      const tokensPerProject = 4000;
      const totalTokens = projectCount * tokensPerProject;
      const cost = (totalTokens / 1_000_000) * r.costPerM;
      console.log(
        `| ${r.model} | ${r.costPerM.toFixed(2)} | ${tokensPerProject} | ${totalTokens.toLocaleString()} | ${cost.toFixed(4)} |`
      );
    }

    // Also print a quick preview of each successful model's bio
    console.log("\n=== Bio Previews ===");
    for (const r of results) {
      if (r.success && r.insights && r.insights.bio) {
        console.log(`${r.model}: ${r.insights.bio.substring(0, 150)}...`);
      }
    }
  }
}

main();