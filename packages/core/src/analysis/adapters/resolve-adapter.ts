import { ClaudeAdapter } from "./claude-adapter.ts";
import { CodexAdapter } from "./codex-adapter.ts";
import { CursorAdapter } from "./cursor-adapter.ts";
import { OpenCodeAdapter } from "./opencode-adapter.ts";
import { OllamaAdapter } from "./ollama-adapter.ts";
import { APIAdapter } from "./api-adapter.ts";
import type { AgentAdapter } from "../../types.ts";

/**
 * Resolve which adapter to use.
 *
 * If --agent is specified, use that adapter.
 * Otherwise, auto-detect: claude → codex → cursor → opencode → api → error.
 */
export async function resolveAdapter(
  agentName?: string
): Promise<{ adapter: AgentAdapter; name: string }> {
  // Explicit agent requested
  if (agentName && agentName !== "auto") {
    const adapter = getAdapterByName(agentName);
    if (!adapter) {
      throw new Error(
        `Unknown agent "${agentName}". Available: claude, codex, cursor, opencode, ollama, api`
      );
    }
    const available = await adapter.isAvailable();
    if (!available) {
      throw new Error(
        `Agent "${agentName}" is not available.\n\n` +
          getSetupInstructions(agentName)
      );
    }
    return { adapter, name: agentName };
  }

  // Auto-detect: try each in priority order
  const candidates: Array<{ name: string; adapter: AgentAdapter }> = [
    { name: "claude", adapter: new ClaudeAdapter() },
    { name: "codex", adapter: new CodexAdapter() },
    { name: "cursor", adapter: new CursorAdapter() },
    { name: "opencode", adapter: new OpenCodeAdapter() },
    { name: "ollama", adapter: new OllamaAdapter() },
    { name: "api", adapter: new APIAdapter() },
  ];

  for (const { name, adapter } of candidates) {
    if (await adapter.isAvailable()) {
      return { adapter, name };
    }
  }

  throw new Error(
    "No AI agent or API key found.\n\n" +
      "Install one of:\n" +
      "  - Claude Code: https://claude.ai/claude-code\n" +
      "  - Codex CLI: npm install -g @openai/codex\n" +
      "  - OpenCode: https://opencode.ai\n" +
      "  - Or set an API key: export OPENROUTER_API_KEY=...\n"
  );
}

export function getAdapterByName(name: string): AgentAdapter | null {
  switch (name) {
    case "claude": return new ClaudeAdapter();
    case "codex": return new CodexAdapter();
    case "cursor": return new CursorAdapter();
    case "opencode": return new OpenCodeAdapter();
    case "ollama": return new OllamaAdapter();
    case "api": return new APIAdapter();
    default: return null;
  }
}

export function getSetupInstructions(name: string): string {
  switch (name) {
    case "claude":
      return "Install Claude Code: https://claude.ai/claude-code";
    case "codex":
      return "Install Codex: npm install -g @openai/codex";
    case "cursor":
      return "Install Cursor: https://cursor.com (agent CLI included)";
    case "opencode":
      return "Install OpenCode: https://opencode.ai";
    case "ollama":
      return "Install Ollama: https://ollama.ai\nThen: ollama pull llama3.1:8b";
    case "api":
      return "Set an API key: export OPENROUTER_API_KEY=... (or ANTHROPIC_API_KEY, OPENAI_API_KEY)\nOr configure interactively: agent-cv generate (choose 'Enter API key' option)";
    default:
      return "";
  }
}
