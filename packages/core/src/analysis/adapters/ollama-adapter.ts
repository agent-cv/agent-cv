import type { AgentAdapter, ProjectAnalysis, ProjectContext } from "../../types.ts";
import { parseOllamaAnalysisResponse } from "../api-parse.ts";

const DEFAULT_OLLAMA_URL = "http://localhost:11434";

/**
 * Default model for new installs and the green "recommended" label in the picker.
 * Chosen for accuracy on local bench (see scripts/bench-ollama.ts): qwen2.5-coder:3b
 * scored 87% ground-truth-stack match at ~10s/project — best of installed options.
 * If a stronger 4B model is already installed (qwen3.5:4b, gemma4:e4b), auto-detect
 * picks it first via PREFERRED_OLLAMA_MODELS order in `isAvailable()`.
 */
export const RECOMMENDED_OLLAMA_MODEL = "qwen2.5-coder:3b";

// Preferred models in priority order — auto-detect picks the first installed match.
// qwen2.5-coder:3b first because scripts/bench-ollama.ts verified 87% gt-score on
// 5 mixed projects (vs 85% llama3.2, 74% gemma3:1b, 54% qwen2.5-coder:0.5b).
// 4B-class candidates listed after — user can opt in by pulling them.
export const PREFERRED_OLLAMA_MODELS: readonly string[] = [
  "qwen2.5-coder:3b", // Verified default: 87% gt-score, ~10s/project on local bench
  "qwen3.5:4b", // 4B class winner per public benchmarks (unverified locally; ~2.5GB)
  "gemma4:e4b", // Native tool calling + 128k context (~9.6GB)
  "ministral-3:3b", // Mistral edge-tuned, native JSON / function calling
  "qwen2.5-coder:7b",
  "qwen2.5-coder:14b",
  "qwen2.5-coder:1.5b",
  "qwen2.5-coder:0.5b",
  "qwen2.5-coder:latest",
  "gemma4:e2b", // Lightest Gemma 4 for very constrained boxes
  "gemma4:26b", // MoE ~3.8B active; needs 24GB+ RAM
  "qwen3-coder:30b", // MoE ~3.3B active, ~19GB; agentic / long context
  "smollm3:3b", // HF reasoning 3B with /think mode, 64k→128k YaRN
  "deepseek-coder-v2:lite",
  "phi4-mini",
  "gemma3:4b",
  "llama3.1:8b",
  "llama3.1:latest",
  "mistral:latest",
];

/**
 * Approximate on-disk size for models not yet pulled (Ollama UI uses similar ballparks).
 * Shown in the CLI picker until the model is installed.
 */
export const OLLAMA_MODEL_SIZE_HINTS: Readonly<Record<string, number>> = {
  "qwen3.5:4b": 2.5e9,
  "gemma4:e4b": 9.6e9,
  "gemma4:e2b": 7.2e9,
  "gemma4:26b": 18e9,
  "ministral-3:3b": 1.8e9,
  "smollm3:3b": 1.8e9,
  "qwen2.5-coder:3b": 1.9e9,
  "qwen2.5-coder:7b": 4.7e9,
  "qwen2.5-coder:14b": 9e9,
  "qwen2.5-coder:1.5b": 1e9,
  "qwen2.5-coder:0.5b": 0.4e9,
  "qwen2.5-coder:latest": 1.9e9,
  "qwen3-coder:30b": 19e9,
  "deepseek-coder-v2:lite": 8.9e9,
  "phi4-mini": 2.4e9,
  "gemma3:4b": 3.3e9,
  "llama3.1:8b": 4.7e9,
  "llama3.1:latest": 4.7e9,
  "mistral:latest": 4.4e9,
};

export type OllamaModelPickerEntry = {
  name: string;
  size: number;
  isRecommended: boolean;
  needsDownload: boolean;
};

/**
 * List for the Ink picker: all preferred models (with pull hints if missing), then any
 * other models already in Ollama that are not in the preferred list.
 */
export function mergePreferredAndInstalledOllamaModels(
  installed: Array<{ name: string; size: number }>
): OllamaModelPickerEntry[] {
  const byName = new Map(installed.map((m) => [m.name, m]));
  const out: OllamaModelPickerEntry[] = [];
  const seen = new Set<string>();

  for (const name of PREFERRED_OLLAMA_MODELS) {
    const local = byName.get(name);
    if (local) {
      out.push({
        name,
        size: local.size,
        isRecommended: name === RECOMMENDED_OLLAMA_MODEL,
        needsDownload: false,
      });
    } else {
      out.push({
        name,
        size: OLLAMA_MODEL_SIZE_HINTS[name] ?? 2e9,
        isRecommended: name === RECOMMENDED_OLLAMA_MODEL,
        needsDownload: true,
      });
    }
    seen.add(name);
  }
  for (const m of installed) {
    if (!seen.has(m.name)) {
      out.push({
        name: m.name,
        size: m.size,
        isRecommended: m.name === RECOMMENDED_OLLAMA_MODEL,
        needsDownload: false,
      });
    }
  }
  return out;
}

/**
 * Ollama adapter for local LLM analysis.
 * Auto-detects running Ollama instance and best available model.
 * Free, private, no API key needed.
 */
export class OllamaAdapter implements AgentAdapter {
  name = "ollama";
  /**
   * Local Ollama serializes requests against a single loaded model by default.
   * Use 1 unless the user has explicitly set OLLAMA_NUM_PARALLEL on the daemon.
   * The pipeline reads this to override its default batch size of 8.
   */
  maxConcurrency = Number(process.env.OLLAMA_NUM_PARALLEL) || 1;
  private baseUrl: string;
  private model: string | null;
  private detectedModel: string | null = null;

  constructor() {
    this.baseUrl = process.env.OLLAMA_HOST || DEFAULT_OLLAMA_URL;
    this.model = process.env.AGENT_CV_MODEL || null;
  }

  async isAvailable(): Promise<boolean> {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 2000);
      const response = await fetch(`${this.baseUrl}/api/tags`, { signal: controller.signal });
      clearTimeout(timeout);
      if (!response.ok) return false;
      const data = (await response.json()) as { models?: Array<{ name: string }> };
      if (!Array.isArray(data.models) || data.models.length === 0) return false;
      // Auto-detect best model if not explicitly set
      if (!this.model) {
        const available = new Set(data.models.map((m) => m.name));
        this.detectedModel = PREFERRED_OLLAMA_MODELS.find((m) => available.has(m)) || data.models[0]!.name;
      }
      return true;
    } catch {
      return false;
    }
  }

  /** Get list of available models from Ollama with sizes */
  async getModels(): Promise<Array<{ name: string; size: number }>> {
    try {
      const response = await fetch(`${this.baseUrl}/api/tags`);
      if (!response.ok) return [];
      const data = (await response.json()) as { models?: Array<{ name: string; size: number }> };
      return data.models?.map((m) => ({ name: m.name, size: m.size })) || [];
    } catch {
      return [];
    }
  }

  /** The model that will be used for analysis */
  getModel(): string {
    return this.model || this.detectedModel || RECOMMENDED_OLLAMA_MODEL;
  }

  /** Pull a model with streaming progress. Returns true on success. */
  async pullModel(model: string, onProgress?: (status: string, percent: number) => void): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseUrl}/api/pull`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: model, stream: true }),
      });

      if (!response.ok || !response.body) return false;

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        // Parse newline-delimited JSON
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";
        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const msg = JSON.parse(line);
            if (msg.error) return false;
            const percent = msg.total > 0 && msg.completed ? Math.round((msg.completed / msg.total) * 100) : 0;
            onProgress?.(msg.status || "downloading", percent);
            if (msg.status === "success") return true;
          } catch {
            /* skip malformed lines */
          }
        }
      }
      return true;
    } catch {
      return false;
    }
  }

  async analyze(context: ProjectContext): Promise<ProjectAnalysis> {
    const prompt = buildPrompt(context);
    const model = this.getModel();

    const systemPrompt =
      "You analyze software projects. You return ONLY valid JSON. Never copy example values. Base your analysis strictly on the provided project data.";

    // Use OpenAI-compatible endpoint. `response_format: json_object` forces the
    // model to emit syntactically valid JSON, eliminating regex-extraction failures
    // we used to see on small models. Skip when caller wants raw text (bio prompts).
    const body: Record<string, unknown> = {
      model,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: prompt },
      ],
      temperature: 0.3,
      stream: false,
    };
    if (!context.rawPrompt) {
      body.response_format = { type: "json_object" };
    }
    const response = await fetchWithTimeout(`${this.baseUrl}/v1/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const text = await response.text();
      if (response.status === 404 && text.includes("model")) {
        throw new Error(`Ollama model "${model}" not found. Run: ollama pull ${model}`);
      }
      throw new Error(`Ollama error ${response.status}: ${text.slice(0, 200)}`);
    }

    const json = (await response.json()) as any;
    const content = json.choices?.[0]?.message?.content || "";

    if (context.rawPrompt) {
      return {
        summary: content,
        techStack: [],
        contributions: [],
        analyzedAt: new Date().toISOString(),
        analyzedBy: "ollama",
      };
    }

    return parseOllamaAnalysisResponse(content, { projectName: context.displayName });
  }
}

async function fetchWithTimeout(url: string, init: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 180_000); // 3 min for local models
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (err: any) {
    if (err.name === "AbortError") throw new Error("Ollama request timed out after 180s");
    throw err;
  } finally {
    clearTimeout(timeout);
  }
}

function buildPrompt(context: ProjectContext): string {
  if (context.rawPrompt) return context.rawPrompt;

  const parts: string[] = [];

  // Ownership context first — critical framing for analysis
  const isOwner = context.isOwner !== false && (context.authorCommitCount ?? 0) > 0;
  const authorInfo = context.commitCount
    ? `User authored ${context.authorCommitCount ?? 0} of ${context.commitCount} commits.`
    : "";
  if (!isOwner) {
    parts.push(`# NOTE: The user is NOT the author of this project. ${authorInfo} They cloned/studied it.`);
    parts.push(
      "Do NOT describe the project's features as if the user built them. Do NOT copy marketing taglines from the README."
    );
    parts.push(
      "Instead describe what a reader learns about the user: familiarity with this stack/domain, the kind of code they were exploring."
    );
    parts.push("");
  } else if (authorInfo) {
    parts.push(`# AUTHOR INFO: ${authorInfo}`, "");
  }

  // Project data — small models attend to what they see first
  if (context.readme) parts.push("# README", context.readme.slice(0, 2000), "");
  if (context.dependencies) parts.push("# DEPENDENCIES", context.dependencies.slice(0, 1000), "");
  if (context.directoryTree) parts.push("# FILE STRUCTURE", context.directoryTree.slice(0, 1000), "");
  if (context.recentCommits) parts.push("# RECENT COMMITS", context.recentCommits.slice(0, 1000), "");

  parts.push("---");
  parts.push("Based on the project above, return a JSON object with these fields:");
  parts.push(
    '- "summary": 2-3 sentences describing the product/value of THIS project — what it does and why it matters. Do not restate the stack.'
  );
  parts.push(
    '- "techStack": array of 3-8 real technologies actually used. Include: languages, frameworks, databases, notable libraries. EXCLUDE: workspace-internal packages (anything starting with "@<projectName>/"), hosting providers (Vercel, Railway, Neon, Fly, Heroku, AWS), CI services (GitHub Actions), and generic words like "Node.js" when a framework already implies it.'
  );
  if (isOwner) {
    parts.push(
      '- "contributions": array of 3-5 CAPABILITIES the user demonstrated by building this. Phrase each as a skill or piece of engineering work (e.g. "Designed HLC-based LWW conflict resolution", "Built GitHub OAuth device flow for a CLI", "Implemented schema-aware Postgres migrations"). Do NOT copy commit messages verbatim. Do NOT use changelog language like "Fixed X", "Updated Y", "Bumped Z".'
    );
  } else {
    parts.push(
      '- "contributions": array of 2-3 short items describing what the USER can take away from having read this code (e.g. "Explored Solana program anchoring patterns", "Studied Remotion timeline internals"). Start each with a past-tense verb about the user, NOT about the project.'
    );
  }
  parts.push(
    '- "impactScore": integer 1-10. Anchors: 1=tutorial/demo, 3=hobby experiment or small utility, 5=solid side project with real use, 7=production app that other people depend on, 9=widely used infrastructure. Be calibrated — most side projects are 3-5, not 7.'
  );

  if (context.previousAnalysis) {
    parts.push("");
    parts.push("Previous analysis to update:", JSON.stringify(context.previousAnalysis));
  }

  parts.push("");
  parts.push("Return ONLY the JSON object. No markdown, no explanation.");

  return parts.join("\n");
}
