#!/usr/bin/env bun
/**
 * Agent-loop POC: model uses tools to explore a project, single-shot only when it's
 * ready. Compares to scripts/bench-ollama.ts single-shot output.
 *
 * Tools (read-only, sandboxed to project root):
 *   - list_dir(path)
 *   - read_file(path, max_bytes?)
 *   - grep(pattern, max_results?)
 *
 * Usage:
 *   bun scripts/bench-agent.ts --project ~/Projects/orgs/agent-cv/agent-cv
 *   bun scripts/bench-agent.ts --project <path> --model qwen2.5-coder:3b --max-steps 12
 */
import { readdir, readFile, stat } from "node:fs/promises";
import { join, relative, resolve as resolvePath, sep, isAbsolute } from "node:path";
import { homedir } from "node:os";
import { extractFirstJsonObject } from "../packages/core/src/analysis/api-parse.ts";

type Args = {
  project: string;
  model: string;
  maxSteps: number;
  verbose: boolean;
};

function expandHome(p: string): string {
  if (p === "~") return homedir();
  if (p.startsWith("~/")) return join(homedir(), p.slice(2));
  return p;
}

function parseArgs(argv: string[]): Args {
  const out: Args = {
    project: "",
    model: process.env.AGENT_CV_MODEL || "qwen2.5-coder:3b",
    maxSteps: 12,
    verbose: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const n = argv[i + 1];
    if (a === "--project" && n) {
      out.project = resolvePath(expandHome(n));
      i++;
    } else if (a === "--model" && n) {
      out.model = n;
      i++;
    } else if (a === "--max-steps" && n) {
      out.maxSteps = Number(n) || 12;
      i++;
    } else if (a === "--verbose" || a === "-v") {
      out.verbose = true;
    } else if (a === "--help" || a === "-h") {
      console.log("usage: bun scripts/bench-agent.ts --project <path> [--model X] [--max-steps N] [-v]");
      process.exit(0);
    }
  }
  if (!out.project) {
    console.error("error: --project required");
    process.exit(1);
  }
  return out;
}

/**
 * Resolve a model-provided path under projectRoot, rejecting anything that
 * escapes the sandbox (absolute paths, parent-dir traversal, symlinks).
 */
function safePath(projectRoot: string, requested: string): string | null {
  if (!requested) return null;
  if (isAbsolute(requested)) return null;
  const full = resolvePath(projectRoot, requested);
  // Ensure full path is under projectRoot
  const rel = relative(projectRoot, full);
  if (rel.startsWith("..") || rel === "" || isAbsolute(rel)) {
    if (full === projectRoot) return projectRoot;
    return null;
  }
  return full;
}

const SKIP = new Set(["node_modules", ".git", "dist", "build", "vendor", "target", ".next", ".venv", "coverage"]);

async function toolListDir(projectRoot: string, args: { path?: string }): Promise<string> {
  const requested = args.path?.toString() ?? ".";
  const dir = requested === "." || requested === "" ? projectRoot : safePath(projectRoot, requested);
  if (!dir) return `error: path outside project root or invalid: ${requested}`;
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    const lines: string[] = [];
    for (const e of entries) {
      if (SKIP.has(e.name) || e.name.startsWith(".")) continue;
      lines.push(`${e.name}${e.isDirectory() ? "/" : ""}`);
    }
    lines.sort();
    return lines.slice(0, 100).join("\n") || "(empty)";
  } catch (err: any) {
    return `error: ${err.message}`;
  }
}

async function toolReadFile(
  projectRoot: string,
  args: { path?: string; max_bytes?: number }
): Promise<string> {
  const requested = args.path?.toString() ?? "";
  const file = safePath(projectRoot, requested);
  if (!file) return `error: path outside project root: ${requested}`;
  const maxBytes = Math.min(Number(args.max_bytes) || 4000, 16000);
  try {
    const buf = await readFile(file, "utf-8");
    if (buf.length > maxBytes) {
      return buf.slice(0, maxBytes) + `\n...(truncated, ${buf.length - maxBytes} more bytes)`;
    }
    return buf;
  } catch (err: any) {
    return `error: ${err.message}`;
  }
}

async function toolGrep(
  projectRoot: string,
  args: { pattern?: string; max_results?: number }
): Promise<string> {
  const pattern = args.pattern?.toString();
  if (!pattern) return "error: pattern required";
  const maxResults = Math.min(Number(args.max_results) || 20, 50);

  let re: RegExp;
  try {
    re = new RegExp(pattern, "i");
  } catch {
    return `error: invalid regex: ${pattern}`;
  }

  const hits: string[] = [];
  async function walk(dir: string, depth: number) {
    if (depth > 3 || hits.length >= maxResults) return;
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (hits.length >= maxResults) return;
      if (SKIP.has(e.name) || e.name.startsWith(".")) continue;
      const full = join(dir, e.name);
      if (e.isFile()) {
        try {
          const buf = await readFile(full, "utf-8");
          const lines = buf.split("\n");
          for (let i = 0; i < lines.length; i++) {
            if (re.test(lines[i]!)) {
              hits.push(`${relative(projectRoot, full)}:${i + 1}: ${lines[i]!.slice(0, 120)}`);
              if (hits.length >= maxResults) return;
            }
          }
        } catch {
          /* binary or unreadable */
        }
      } else if (e.isDirectory()) {
        await walk(full, depth + 1);
      }
    }
  }
  await walk(projectRoot, 0);
  return hits.join("\n") || "(no matches)";
}

const TOOLS = [
  {
    type: "function" as const,
    function: {
      name: "list_dir",
      description: "List files and subdirectories at a path relative to the project root. Use '.' for root.",
      parameters: {
        type: "object",
        properties: { path: { type: "string", description: "Relative path under project root" } },
        required: ["path"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "read_file",
      description: "Read a file's contents (UTF-8). Up to max_bytes (default 4000).",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "Relative path under project root" },
          max_bytes: { type: "integer", description: "Max bytes to return", default: 4000 },
        },
        required: ["path"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "grep",
      description: "Case-insensitive regex search across project files (depth 3, skips node_modules etc).",
      parameters: {
        type: "object",
        properties: {
          pattern: { type: "string", description: "Regex pattern" },
          max_results: { type: "integer", description: "Max matching lines", default: 20 },
        },
        required: ["pattern"],
      },
    },
  },
];

const SYSTEM_PROMPT = `You analyze software projects. Be precise. Base every claim on file contents you read.

Workflow:
1. Call list_dir(".") to see top-level files.
2. Call read_file("README.md") to learn what the project does.
3. Call read_file("package.json") or relevant manifest to learn the real tech stack.
4. Optionally one more read_file or grep to clarify.
5. Output the final JSON.

CRITICAL RULES:
- techStack MUST only contain libraries/frameworks you literally saw in deps. No "Express.js" unless package.json has it.
- summary MUST come from the README's actual description, not generic boilerplate.
- contributions describe capabilities the author demonstrated; phrase as past-tense skills.
- 3-5 tool calls total is enough. Don't read random files.

Final output: ONLY a JSON object with summary, techStack, contributions, impactScore. No prose.`;

type Msg =
  | { role: "system"; content: string }
  | { role: "user"; content: string }
  | { role: "assistant"; content: string; tool_calls?: Array<{ function: { name: string; arguments: Record<string, unknown> } }> }
  | { role: "tool"; content: string; name?: string };

async function chatCall(
  baseUrl: string,
  model: string,
  messages: Msg[],
  withTools: boolean
): Promise<{ message: { role: string; content: string; tool_calls?: any[] } }> {
  const body: Record<string, unknown> = {
    model,
    messages,
    stream: false,
    options: { temperature: 0.2 },
  };
  if (withTools) body.tools = TOOLS;
  const res = await fetch(`${baseUrl}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`ollama /api/chat ${res.status}: ${text.slice(0, 300)}`);
  }
  return (await res.json()) as any;
}

/**
 * Force a JSON-only response via the OpenAI-compatible endpoint's response_format.
 * Used when the agent loop ends without producing parseable JSON.
 */
async function chatCallStructured(baseUrl: string, model: string, messages: Msg[]): Promise<string> {
  // OpenAI-compat endpoint expects {role, content} only; strip tool_calls/tool messages.
  const flat = messages
    .filter((m) => m.role !== "tool")
    .map((m) => ({ role: m.role, content: (m as any).content || "" }));
  const res = await fetch(`${baseUrl}/v1/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      messages: flat,
      stream: false,
      temperature: 0.2,
      response_format: { type: "json_object" },
    }),
  });
  if (!res.ok) {
    return "";
  }
  const j = (await res.json()) as any;
  return j.choices?.[0]?.message?.content || "";
}

/**
 * Fallback for models that don't honor Ollama's `tools` param but still emit tool
 * calls as JSON in their content. Matches:
 *   {"name": "list_dir", "arguments": {"path": "."}}
 * or fenced inside ```json blocks.
 */
function parseInlineToolCalls(
  content: string
): Array<{ function: { name: string; arguments: Record<string, unknown> } }> {
  const out: Array<{ function: { name: string; arguments: Record<string, unknown> } }> = [];
  // Strip code fences
  const cleaned = content.replace(/```(?:json)?\s*/g, "").replace(/```/g, "");
  // Try to match each top-level JSON object containing "name" and "arguments"
  const re = /\{[^{}]*"name"\s*:\s*"([a-z_]+)"[^{}]*"arguments"\s*:\s*(\{[^{}]*\}|\{[\s\S]*?\})\s*\}/g;
  for (const m of cleaned.matchAll(re)) {
    try {
      const fullJson = m[0];
      const parsed = JSON.parse(fullJson);
      if (parsed.name && parsed.arguments && typeof parsed.arguments === "object") {
        out.push({ function: { name: parsed.name, arguments: parsed.arguments } });
      }
    } catch {
      /* skip malformed */
    }
  }
  return out;
}

async function dispatchTool(
  projectRoot: string,
  name: string,
  argsObj: Record<string, unknown>
): Promise<string> {
  if (name === "list_dir") return await toolListDir(projectRoot, argsObj as any);
  if (name === "read_file") return await toolReadFile(projectRoot, argsObj as any);
  if (name === "grep") return await toolGrep(projectRoot, argsObj as any);
  return `error: unknown tool: ${name}`;
}

async function runAgent(project: string, model: string, maxSteps: number, verbose: boolean) {
  const baseUrl = process.env.OLLAMA_HOST || "http://localhost:11434";
  const messages: Msg[] = [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: `Analyze the project at ./ (project root). Use the tools to explore.` },
  ];

  let toolCallCount = 0;
  const t0 = Date.now();

  for (let step = 0; step < maxSteps; step++) {
    const res = await chatCall(baseUrl, model, messages, true);
    const msg = res.message;
    if (verbose) console.error(`\n[step ${step + 1}] content=${(msg.content || "").slice(0, 120)} tool_calls=${msg.tool_calls?.length ?? 0}`);

    // If native Ollama tool_calls absent, look for JSON-encoded tool calls inside content
    // (models like qwen2.5-coder:3b emit them this way despite the `tools` param).
    let toolCalls = msg.tool_calls ?? [];
    if (toolCalls.length === 0 && msg.content) {
      const parsed = parseInlineToolCalls(msg.content);
      if (parsed.length > 0) {
        toolCalls = parsed;
        if (verbose) console.error(`  parsed ${parsed.length} inline tool_call(s) from content`);
      }
    }
    if (toolCalls.length === 0) {
      // Try to parse JSON from current content
      let analysis: any = null;
      let jsonValid = false;
      try {
        analysis = JSON.parse(extractFirstJsonObject(msg.content));
        jsonValid = true;
      } catch {
        /* not yet */
      }

      if (jsonValid) {
        return {
          ok: true,
          jsonValid: true,
          latencyMs: Date.now() - t0,
          steps: step + 1,
          toolCallCount,
          analysis,
          raw: msg.content,
        };
      }

      // No tool calls AND no JSON — model went prose. Push a strict reminder and re-call
      // with response_format json_object via OpenAI-compat endpoint (forces grammar).
      if (verbose) console.error("  no tool_calls and no JSON — forcing structured output");
      messages.push({ role: "assistant", content: msg.content });
      messages.push({
        role: "user",
        content:
          "Now output ONLY the JSON object with fields summary, techStack, contributions, impactScore. No prose, no markdown, no explanation.",
      });
      const forced = await chatCallStructured(baseUrl, model, messages);
      const latencyMs = Date.now() - t0;
      try {
        analysis = JSON.parse(extractFirstJsonObject(forced));
        jsonValid = true;
      } catch {
        /* */
      }
      return {
        ok: jsonValid,
        jsonValid,
        latencyMs,
        steps: step + 2,
        toolCallCount,
        analysis,
        raw: forced,
        note: "forced final via response_format",
      };
    }

    // Append assistant message with tool calls + each tool result
    messages.push({ role: "assistant", content: msg.content || "", tool_calls: toolCalls as any });
    for (const call of toolCalls) {
      const name = call.function?.name;
      const argsObj = (call.function?.arguments || {}) as Record<string, unknown>;
      if (verbose) console.error(`  -> ${name}(${JSON.stringify(argsObj).slice(0, 80)})`);
      const result = await dispatchTool(project, name, argsObj);
      toolCallCount++;
      if (verbose) console.error(`     <- ${result.slice(0, 100)}${result.length > 100 ? "..." : ""}`);
      messages.push({ role: "tool", content: result, name });
    }
  }

  // Out of steps — force a final answer turn without tools
  messages.push({
    role: "user",
    content: "Stop using tools. Based on what you've seen, output the final JSON object now.",
  });
  const final = await chatCall(baseUrl, model, messages, false);
  const latencyMs = Date.now() - t0;
  let analysis: any = null;
  let jsonValid = false;
  try {
    analysis = JSON.parse(extractFirstJsonObject(final.message.content));
    jsonValid = true;
  } catch {
    /* leave null */
  }
  return {
    ok: jsonValid,
    jsonValid,
    latencyMs,
    steps: maxSteps + 1,
    toolCallCount,
    analysis,
    raw: final.message.content,
    note: "max steps reached, forced final",
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  console.error(`> agent: model=${args.model} project=${args.project}`);
  try {
    await stat(args.project);
  } catch {
    console.error(`error: project path not found`);
    process.exit(1);
  }
  const result = await runAgent(args.project, args.model, args.maxSteps, args.verbose);

  console.log(`\n## Result`);
  console.log(`steps: ${result.steps}, tool_calls: ${result.toolCallCount}, latency: ${(result.latencyMs / 1000).toFixed(1)}s, json: ${result.jsonValid ? "✓" : "✗"}`);
  if (result.analysis) {
    console.log(`\nfull JSON:\n${JSON.stringify(result.analysis, null, 2)}`);
  } else {
    console.log(`\nraw output (no JSON):`);
    console.log(result.raw.slice(0, 600));
  }
}

if (import.meta.main) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
