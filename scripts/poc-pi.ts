#!/usr/bin/env bun
/**
 * POC: use @earendil-works/pi-agent-core as the agent runtime to analyze a
 * single project. Drives the same kind of read-only exploration our
 * scripts/bench-agent.ts does, but using Pi for the loop, tool dispatch,
 * and streaming instead of a hand-rolled one.
 *
 * Usage:
 *   bun scripts/poc-pi.ts --project ~/Projects/orgs/TacticLaunch/screen-studio-reproduction
 *   bun scripts/poc-pi.ts --project ~/Projects/orgs/agent-cv/agent-cv --model qwen2.5-coder:3b --verbose
 *
 * Compare summary quality vs scripts/bench-ollama.ts and bench-agent.ts.
 */
import { readdir, readFile } from "node:fs/promises";
import { join, relative, resolve as resolvePath, isAbsolute } from "node:path";
import { homedir } from "node:os";
import { Agent } from "@earendil-works/pi-agent-core";
import type { Model } from "@earendil-works/pi-ai";
import { Type } from "typebox";

type Args = {
  project: string;
  model: string;
  verbose: boolean;
  maxSteps: number;
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
    verbose: false,
    maxSteps: 14,
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
      out.maxSteps = Number(n) || 14;
      i++;
    } else if (a === "-v" || a === "--verbose") {
      out.verbose = true;
    } else if (a === "-h" || a === "--help") {
      console.log("usage: bun scripts/poc-pi.ts --project <path> [--model X] [-v]");
      process.exit(0);
    }
  }
  if (!out.project) {
    console.error("error: --project required");
    process.exit(1);
  }
  return out;
}

const SKIP = new Set(["node_modules", ".git", "dist", "build", "vendor", "target", ".next", ".venv", "coverage"]);

function safePath(root: string, requested: string): string | null {
  if (!requested) return null;
  if (isAbsolute(requested)) return null;
  const full = resolvePath(root, requested);
  const rel = relative(root, full);
  if (rel.startsWith("..") || isAbsolute(rel)) {
    if (full === root) return root;
    return null;
  }
  return full;
}

/**
 * Build the tool set bound to `projectRoot`. Each call is sandboxed —
 * paths that escape the root are rejected. Used so a small model can
 * explore the project without filesystem access elsewhere.
 */
function buildTools(projectRoot: string) {
  return [
    {
      name: "list_dir",
      description: "List files and subdirectories at a path relative to the project root. Use '.' for root.",
      parameters: Type.Object({ path: Type.String() }),
      execute: async (_toolCallId: string, params: { path: string }) => {
        const requested = params.path ?? ".";
        const dir = requested === "." || requested === "" ? projectRoot : safePath(projectRoot, requested);
        if (!dir) return { content: [{ type: "text" as const, text: `error: path outside project root: ${requested}` }] };
        try {
          const entries = await readdir(dir, { withFileTypes: true });
          const lines: string[] = [];
          for (const e of entries) {
            if (SKIP.has(e.name) || e.name.startsWith(".")) continue;
            lines.push(`${e.name}${e.isDirectory() ? "/" : ""}`);
          }
          lines.sort();
          return { content: [{ type: "text" as const, text: lines.slice(0, 200).join("\n") || "(empty)" }] };
        } catch (err: any) {
          return { content: [{ type: "text" as const, text: `error: ${err.message}` }] };
        }
      },
    },
    {
      name: "read_file",
      description: "Read a UTF-8 file. Returns at most max_bytes (default 4000, max 16000).",
      parameters: Type.Object({
        path: Type.String(),
        max_bytes: Type.Optional(Type.Number()),
      }),
      execute: async (_toolCallId: string, params: { path: string; max_bytes?: number }) => {
        const file = safePath(projectRoot, params.path);
        if (!file) return { content: [{ type: "text" as const, text: `error: path outside project root: ${params.path}` }] };
        const maxBytes = Math.min(params.max_bytes ?? 4000, 16000);
        try {
          const buf = await readFile(file, "utf-8");
          const text = buf.length > maxBytes
            ? buf.slice(0, maxBytes) + `\n...(truncated, ${buf.length - maxBytes} more bytes)`
            : buf;
          return { content: [{ type: "text" as const, text }] };
        } catch (err: any) {
          return { content: [{ type: "text" as const, text: `error: ${err.message}` }] };
        }
      },
    },
    {
      name: "grep",
      description: "Case-insensitive regex search across project files (depth 3, skips node_modules etc).",
      parameters: Type.Object({
        pattern: Type.String(),
        max_results: Type.Optional(Type.Number()),
      }),
      execute: async (_toolCallId: string, params: { pattern: string; max_results?: number }) => {
        const maxResults = Math.min(params.max_results ?? 20, 50);
        let re: RegExp;
        try {
          re = new RegExp(params.pattern, "i");
        } catch {
          return { content: [{ type: "text" as const, text: `error: invalid regex: ${params.pattern}` }] };
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
                /* binary */
              }
            } else if (e.isDirectory()) {
              await walk(full, depth + 1);
            }
          }
        }
        await walk(projectRoot, 0);
        return { content: [{ type: "text" as const, text: hits.join("\n") || "(no matches)" }] };
      },
    },
  ];
}

const SYSTEM_PROMPT = `You analyze software projects to produce a structured technical CV entry. Be precise. Base every claim on file contents you read with the tools.

Recommended exploration:
1. list_dir(".") to see top-level layout.
2. read_file the most descriptive markdown: prefer CLAUDE.md, AGENTS.md, ARCHITECTURE.md, README.md (in that order). Many monorepos have an empty README and a detailed CLAUDE.md.
3. read_file the manifest: package.json, Cargo.toml, pyproject.toml, etc. For monorepos with no root manifest, list_dir into apps/* or packages/* and read one or two child manifests.
4. Optionally one targeted read_file or grep to clarify.

Rules:
- techStack: only libraries / frameworks you saw in manifests or imports. No guesses from project name alone.
- summary: 2-3 sentences on what the project DOES, grounded in CLAUDE.md / README content. If the project is a "reproduction of" or "clone of" something, say so.
- contributions: 3-5 phrases describing engineering capabilities demonstrated.
- impactScore: 1-10. Production-grade work with tests/docs/architecture scores higher.
- Aim for 4-7 tool calls. Stop once you have a clear picture.

Final output: ONLY a single JSON object with fields summary, techStack, contributions, impactScore. No prose before or after.`;

async function main() {
  const args = parseArgs(process.argv.slice(2));
  console.error(`> pi POC: model=${args.model} project=${args.project}`);

  const baseUrl = process.env.OLLAMA_HOST || "http://localhost:11434";
  const model: Model<"openai-completions"> = {
    id: args.model,
    name: args.model,
    api: "openai-completions",
    provider: "ollama",
    baseUrl: `${baseUrl}/v1`,
    reasoning: false,
    input: ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 32000,
    maxTokens: 4000,
  };

  const agent = new Agent({
    initialState: {
      systemPrompt: SYSTEM_PROMPT,
      model,
      tools: buildTools(args.project),
    },
    // Ollama doesn't auth, but pi-ai providers throw without an apiKey
    // — provide a stub so the openai-completions stream client passes its
    // `!apiKey` check.
    getApiKey: async () => "dummy",
  });

  let toolCalls = 0;
  if (args.verbose) {
    agent.subscribe((event: any) => {
      if (event.type === "tool_call") {
        toolCalls++;
        console.error(`  -> ${event.name}(${JSON.stringify(event.params).slice(0, 100)})`);
      } else if (event.type === "tool_result") {
        const text = event.result?.content?.[0]?.text ?? "";
        console.error(`     <- ${text.slice(0, 120)}${text.length > 120 ? "..." : ""}`);
      } else if (event.type === "message_update" && event.assistantMessageEvent?.type === "text_delta") {
        process.stderr.write(event.assistantMessageEvent.delta);
      }
    });
  } else {
    agent.subscribe((event: any) => {
      if (event.type === "tool_call") toolCalls++;
    });
  }

  const t0 = Date.now();
  try {
    await agent.prompt(`Analyze the project at the project root. Use the tools to explore, then output the final JSON.`);
  } catch (err: any) {
    console.error(`\nagent error: ${err.message}`);
    process.exit(1);
  }
  const latencyMs = Date.now() - t0;

  // Pull the final assistant message
  const state: any = agent.state as any;
  const messages = state.messages ?? state.history ?? [];
  const lastAssistant = [...messages].reverse().find((m: any) => m.role === "assistant");
  const content = lastAssistant?.content
    ?.filter?.((c: any) => c.type === "text")
    ?.map?.((c: any) => c.text)
    ?.join("\n") ?? "";

  console.log(`\n## Result`);
  console.log(`model=${args.model} latency=${(latencyMs / 1000).toFixed(1)}s tool_calls=${toolCalls}`);
  console.log(`\n--- raw assistant output ---`);
  console.log(content || "(empty)");

  // Try to extract JSON
  let parsed: any = null;
  const match = content.match(/\{[\s\S]*\}/);
  if (match) {
    try {
      parsed = JSON.parse(match[0]);
    } catch {
      /* malformed */
    }
  }
  if (parsed) {
    console.log(`\n--- parsed ---`);
    console.log(JSON.stringify(parsed, null, 2));
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
