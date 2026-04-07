import type { AgentAdapter, ProjectAnalysis, ProjectContext } from "../types.ts";

const DEFAULT_OLLAMA_URL = "http://localhost:11434";
// Preferred models in priority order
const PREFERRED_MODELS = ["llama3.1:8b", "llama3.1:latest", "llama3:latest", "mistral:latest", "gemma2:latest"];

/**
 * Ollama adapter for local LLM analysis.
 * Auto-detects running Ollama instance and best available model.
 * Free, private, no API key needed.
 */
export class OllamaAdapter implements AgentAdapter {
  name = "ollama";
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
      const data = await response.json() as { models?: Array<{ name: string }> };
      if (!Array.isArray(data.models) || data.models.length === 0) return false;
      // Auto-detect best model if not explicitly set
      if (!this.model) {
        const available = new Set(data.models.map((m) => m.name));
        this.detectedModel = PREFERRED_MODELS.find((m) => available.has(m)) || data.models[0]!.name;
      }
      return true;
    } catch {
      return false;
    }
  }

  /** Get list of available models from Ollama */
  async getModels(): Promise<string[]> {
    try {
      const response = await fetch(`${this.baseUrl}/api/tags`);
      if (!response.ok) return [];
      const data = await response.json() as { models?: Array<{ name: string }> };
      return data.models?.map((m) => m.name) || [];
    } catch {
      return [];
    }
  }

  /** The model that will be used for analysis */
  getModel(): string {
    return this.model || this.detectedModel || "llama3.1:8b";
  }

  async analyze(context: ProjectContext): Promise<ProjectAnalysis> {
    const prompt = buildPrompt(context);
    const model = this.getModel();

    // Use OpenAI-compatible endpoint
    const response = await fetchWithTimeout(`${this.baseUrl}/v1/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        messages: [{ role: "user", content: prompt }],
        temperature: 0.3,
        stream: false,
      }),
    });

    if (!response.ok) {
      const text = await response.text();
      if (response.status === 404 && text.includes("model")) {
        throw new Error(`Ollama model "${model}" not found. Run: ollama pull ${model}`);
      }
      throw new Error(`Ollama error ${response.status}: ${text.slice(0, 200)}`);
    }

    const json = await response.json() as any;
    const content = json.choices?.[0]?.message?.content || "";

    if (context.rawPrompt) {
      return { summary: content, techStack: [], contributions: [], analyzedAt: new Date().toISOString(), analyzedBy: "ollama" };
    }

    return parseResponse(content);
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

  if (context.previousAnalysis) {
    parts.push(
      "Previous analysis:", JSON.stringify(context.previousAnalysis, null, 2), "",
      "Project changed since. Update the analysis. Respond with ONLY JSON:",
    );
  } else {
    parts.push("Analyze this software project. Respond with ONLY a JSON object (no markdown, no explanation).", "");
  }

  parts.push('{"summary": "2-3 sentence description", "techStack": ["Tech1", "Tech2"], "contributions": ["Key feature 1", "Key feature 2"], "impactScore": 7}', "");
  parts.push("impactScore: Rate 1-10. Consider: technical complexity, real-world value, engineering quality, scope.", "");
  if (context.readme) parts.push("=== README ===", context.readme.slice(0, 3000), "");
  if (context.dependencies) parts.push("=== DEPENDENCIES ===", context.dependencies.slice(0, 1500), "");
  if (context.directoryTree) parts.push("=== DIRECTORY STRUCTURE ===", context.directoryTree.slice(0, 1500), "");
  if (context.recentCommits) parts.push("=== RECENT COMMITS ===", context.recentCommits.slice(0, 1500), "");

  return parts.join("\n");
}

function parseResponse(raw: string): ProjectAnalysis {
  const jsonMatch = raw.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error("No JSON found in Ollama response");

  const parsed = JSON.parse(jsonMatch[0]);
  const analysis: ProjectAnalysis = {
    summary: parsed.summary || "",
    techStack: Array.isArray(parsed.techStack) ? parsed.techStack : [],
    contributions: Array.isArray(parsed.contributions) ? parsed.contributions : [],
    impactScore: typeof parsed.impactScore === "number" ? Math.min(10, Math.max(1, parsed.impactScore)) : undefined,
    analyzedAt: new Date().toISOString(),
    analyzedBy: "ollama",
  };

  if (!analysis.summary) throw new Error("Analysis has empty summary");
  if (analysis.techStack.length === 0) throw new Error("Analysis has empty techStack");

  return analysis;
}
