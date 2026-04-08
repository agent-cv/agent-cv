import { join } from "node:path";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { getDataDir } from "./data-dir.ts";

const CREDENTIALS_FILE = "credentials.json";

export interface SavedCredentials {
  apiKey?: string;
  provider?: "openrouter" | "anthropic" | "openai" | "custom";
  baseUrl?: string;
  model?: string;
  githubToken?: string;
}

function getCredentialsPath(): string {
  return join(getDataDir(), CREDENTIALS_FILE);
}

export async function readCredentials(): Promise<SavedCredentials> {
  try {
    const content = await readFile(getCredentialsPath(), "utf-8");
    return JSON.parse(content);
  } catch {
    return {};
  }
}

export async function writeCredentials(creds: SavedCredentials): Promise<void> {
  const dir = getDataDir();
  await mkdir(dir, { recursive: true });
  await writeFile(getCredentialsPath(), JSON.stringify(creds, null, 2), {
    encoding: "utf-8",
    mode: 0o600,
  });
}

/**
 * Resolve GitHub token from: env var → saved credentials → null.
 */
export async function resolveGitHubToken(): Promise<string | null> {
  if (process.env.GITHUB_TOKEN) return process.env.GITHUB_TOKEN;
  const creds = await readCredentials();
  return creds.githubToken || null;
}

/**
 * Resolve API config from: env vars → saved credentials → null.
 */
export function resolveApiConfig(saved?: SavedCredentials): { apiKey: string; baseUrl: string; model: string } | null {
  // 1. Explicit env vars (highest priority)
  const agentCvKey = process.env.AGENT_CV_API_KEY;
  const agentCvUrl = process.env.AGENT_CV_BASE_URL;
  if (agentCvKey && agentCvUrl) {
    return { apiKey: agentCvKey, baseUrl: agentCvUrl, model: process.env.AGENT_CV_MODEL || "gpt-4o" };
  }

  const openRouterKey = process.env.OPENROUTER_API_KEY;
  if (openRouterKey) {
    return { apiKey: openRouterKey, baseUrl: "https://openrouter.ai/api/v1", model: "anthropic/claude-sonnet-4" };
  }

  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  if (anthropicKey) {
    return { apiKey: anthropicKey, baseUrl: "https://api.anthropic.com/v1", model: "claude-sonnet-4-20250514" };
  }

  const openaiKey = process.env.OPENAI_API_KEY;
  if (openaiKey) {
    return { apiKey: openaiKey, baseUrl: "https://api.openai.com/v1", model: "gpt-4o" };
  }

  // 2. Saved credentials
  if (saved?.apiKey && saved?.provider) {
    const providerConfigs: Record<string, { baseUrl: string; model: string }> = {
      openrouter: { baseUrl: "https://openrouter.ai/api/v1", model: "anthropic/claude-sonnet-4" },
      anthropic: { baseUrl: "https://api.anthropic.com/v1", model: "claude-sonnet-4-20250514" },
      openai: { baseUrl: "https://api.openai.com/v1", model: "gpt-4o" },
    };

    if (saved.provider === "custom" && saved.baseUrl) {
      return { apiKey: saved.apiKey, baseUrl: saved.baseUrl, model: saved.model || "gpt-4o" };
    }

    const config = providerConfigs[saved.provider];
    if (config) {
      return { apiKey: saved.apiKey, baseUrl: config.baseUrl, model: saved.model || config.model };
    }
  }

  return null;
}
