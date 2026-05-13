#!/usr/bin/env bun
/**
 * Benchmark Ollama models on real local projects.
 *
 * Builds project context once per project, runs each model against it,
 * measures wall-clock latency and JSON validity. Does NOT touch inventory.
 *
 * Usage:
 *   bun scripts/bench-ollama.ts --projects ~/Projects/orgs/agent-cv,~/Projects/orgs/spool-hq
 *   bun scripts/bench-ollama.ts --models qwen3.5:4b,gemma4:e4b --projects <paths>
 *   bun scripts/bench-ollama.ts --models qwen3.5:4b --pick 5 --root ~/Projects/orgs
 *
 * Flags:
 *   --models    comma-separated ollama tags (default: qwen2.5-coder:3b,qwen3.5:4b,gemma4:e4b,ministral:3b)
 *   --projects  comma-separated absolute project paths
 *   --root      directory to auto-pick projects from (used with --pick)
 *   --pick      number of projects to auto-pick from --root (default: 4)
 *   --pull      pull missing models before benchmarking (default: skip missing)
 *   --json      emit JSON results to stdout instead of markdown table
 */
import { readdir, readFile, stat } from "node:fs/promises";
import { join, basename, resolve as resolvePath } from "node:path";
import { homedir } from "node:os";
import { buildProjectContext } from "../packages/core/src/analysis/context-builder.ts";
import { OllamaAdapter, PREFERRED_OLLAMA_MODELS } from "../packages/core/src/analysis/adapters/ollama-adapter.ts";
import { extractFirstJsonObject } from "../packages/core/src/analysis/api-parse.ts";
import type { Project } from "../packages/core/src/types.ts";

type Args = {
  models: string[];
  projects: string[];
  root: string | null;
  pick: number;
  pull: boolean;
  json: boolean;
};

const DEFAULT_MODELS = [
  "qwen2.5-coder:3b",
  "qwen3.5:4b",
  "gemma4:e4b",
  "ministral-3:3b",
];

function expandHome(p: string): string {
  if (p === "~") return homedir();
  if (p.startsWith("~/")) return join(homedir(), p.slice(2));
  return p;
}

function parseArgs(argv: string[]): Args {
  const args: Args = {
    models: DEFAULT_MODELS,
    projects: [],
    root: null,
    pick: 4,
    pull: false,
    json: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = argv[i + 1];
    if (a === "--models" && next) {
      args.models = next.split(",").map((s) => s.trim()).filter(Boolean);
      i++;
    } else if (a === "--projects" && next) {
      args.projects = next.split(",").map((s) => resolvePath(expandHome(s.trim()))).filter(Boolean);
      i++;
    } else if (a === "--root" && next) {
      args.root = resolvePath(expandHome(next));
      i++;
    } else if (a === "--pick" && next) {
      args.pick = Number(next) || 4;
      i++;
    } else if (a === "--pull") {
      args.pull = true;
    } else if (a === "--json") {
      args.json = true;
    } else if (a === "--help" || a === "-h") {
      console.log(
        "usage: bun scripts/bench-ollama.ts [--models a,b] [--projects /p1,/p2] [--root ~/Projects/orgs] [--pick N] [--pull] [--json]"
      );
      process.exit(0);
    }
  }
  return args;
}

async function detectStack(dir: string): Promise<string | null> {
  try {
    await stat(join(dir, "package.json"));
    return "ts";
  } catch {
    /* */
  }
  try {
    await stat(join(dir, "Cargo.toml"));
    return "rust";
  } catch {
    /* */
  }
  try {
    await stat(join(dir, "pyproject.toml"));
    return "python";
  } catch {
    /* */
  }
  try {
    await stat(join(dir, "requirements.txt"));
    return "python";
  } catch {
    /* */
  }
  try {
    await stat(join(dir, "go.mod"));
    return "go";
  } catch {
    /* */
  }
  return null;
}

/**
 * Walk root 2 levels deep, find dirs with manifests, return diverse sample
 * balanced across stacks (TS/Rust/Python/Go/other).
 */
async function pickProjectsFromRoot(root: string, n: number): Promise<string[]> {
  const SKIP = new Set(["node_modules", ".git", "dist", "build", "vendor", "target", ".next", ".venv"]);
  const found: Array<{ path: string; stack: string }> = [];

  async function walk(dir: string, depth: number) {
    if (depth > 2) return;
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (!e.isDirectory() || e.name.startsWith(".") || SKIP.has(e.name)) continue;
      const sub = join(dir, e.name);
      const stack = await detectStack(sub);
      if (stack) {
        found.push({ path: sub, stack });
      } else if (depth < 2) {
        await walk(sub, depth + 1);
      }
    }
  }

  await walk(root, 0);
  // Round-robin by stack for diversity
  const byStack = new Map<string, string[]>();
  for (const p of found) {
    if (!byStack.has(p.stack)) byStack.set(p.stack, []);
    byStack.get(p.stack)!.push(p.path);
  }
  for (const arr of byStack.values()) arr.sort();
  const stacks = Array.from(byStack.keys());
  const out: string[] = [];
  let idx = 0;
  while (out.length < n && stacks.some((s) => byStack.get(s)!.length > 0)) {
    const s = stacks[idx % stacks.length]!;
    const arr = byStack.get(s)!;
    const next = arr.shift();
    if (next) out.push(next);
    idx++;
  }
  return out;
}

/** Build a minimal Project shape sufficient for buildProjectContext. */
async function fakeProjectFromPath(path: string): Promise<Project> {
  const name = basename(path);
  let isGit = false;
  try {
    const s = await stat(join(path, ".git"));
    isGit = s.isDirectory() || s.isFile();
  } catch {
    /* not git */
  }
  return {
    id: name,
    path,
    displayName: name,
    type: "unknown",
    language: "unknown",
    frameworks: [],
    dateRange: { start: "", end: "", approximate: true },
    hasGit: isGit,
    commitCount: 0,
    authorCommitCount: 0,
    hasUncommittedChanges: false,
    markers: [],
    size: { files: 0, lines: 0 },
    tags: [],
    included: true,
  };
}

type ModelRun = {
  model: string;
  project: string;
  ok: boolean;
  jsonValid: boolean;
  latencyMs: number;
  summary: string;
  techStack: string[];
  rawLen: number;
  /** Jaccard similarity vs ground-truth deps. Higher = less hallucination. */
  hallucinationScore: number;
  /** techStack entries that don't match any ground-truth signal. */
  hallucinated: string[];
  error?: string;
};

/**
 * Extract a normalized set of "real" tech signals from project manifests.
 * Lowercased, with framework aliases collapsed. Used as ground truth to score
 * hallucination on the techStack the LLM returns.
 *
 * Walks 2 levels deep so monorepos / parent dirs still produce useful signals.
 */
export async function extractGroundTruth(path: string): Promise<Set<string>> {
  const signals = new Set<string>();
  const add = (s: string) => {
    const lower = s.toLowerCase();
    signals.add(lower);
    // Scope name without @: "@nestjs/core" -> "nestjs"
    const scope = lower.match(/^@([^/]+)\//);
    if (scope) signals.add(scope[1]!);
    // First token after scope strip: "@nestjs/core" -> "core", "react-dom" -> "react"
    const stripped = lower.replace(/^@[^/]+\//, "").replace(/[-_./].*$/, "");
    if (stripped) signals.add(stripped);
    // Each token split by separators: "node-telegram-bot-api" -> "node","telegram","bot","api"
    for (const t of lower.replace(/^@[^/]+\//, "").split(/[-_./]+/)) {
      if (t.length >= 3) signals.add(t);
    }
  };
  const SKIP = new Set(["node_modules", ".git", "dist", "build", "vendor", "target", ".next", ".venv", "coverage"]);

  async function scanDir(dir: string, depth: number) {
    // package.json
    try {
      const raw = await readFile(join(dir, "package.json"), "utf-8");
      const pkg = JSON.parse(raw);
      for (const k of Object.keys(pkg.dependencies ?? {})) add(k);
      for (const k of Object.keys(pkg.devDependencies ?? {})) add(k);
      for (const k of Object.keys(pkg.peerDependencies ?? {})) add(k);
      // Keywords are explicit project metadata; treat as ground truth signals.
      if (Array.isArray(pkg.keywords)) for (const k of pkg.keywords) add(String(k));
      add("typescript");
      add("javascript");
      add("node");
      add("npm");
    } catch {
      /* */
    }
    try {
      const raw = await readFile(join(dir, "Cargo.toml"), "utf-8");
      add("rust");
      add("cargo");
      for (const m of raw.matchAll(/^\s*([a-z0-9_-]+)\s*=/gim)) add(m[1]!);
    } catch {
      /* */
    }
    try {
      const raw = await readFile(join(dir, "pyproject.toml"), "utf-8");
      add("python");
      // PEP-621 array form: dependencies = ["pkg1", "pkg2 >=1.0", ...]
      const arrayBlock = raw.match(/dependencies\s*=\s*\[([\s\S]*?)\]/);
      if (arrayBlock) {
        for (const m of arrayBlock[1]!.matchAll(/"([^"]+)"/g)) {
          const pkg = m[1]!.split(/[\s<>=!~;]/)[0]!;
          if (pkg) add(pkg);
        }
      }
      // Poetry table form: pkg = "^1.0"
      for (const m of raw.matchAll(/^\s*([a-zA-Z][a-zA-Z0-9_-]*)\s*=\s*["{]/gim)) add(m[1]!);
    } catch {
      /* */
    }
    try {
      const raw = await readFile(join(dir, "requirements.txt"), "utf-8");
      add("python");
      for (const line of raw.split("\n")) {
        const m = line.match(/^([a-zA-Z0-9_-]+)/);
        if (m) add(m[1]!);
      }
    } catch {
      /* */
    }
    try {
      const raw = await readFile(join(dir, "go.mod"), "utf-8");
      add("go");
      add("golang");
      for (const m of raw.matchAll(/^\s*([a-z0-9_./-]+)\s+v[0-9]/gim)) {
        const parts = m[1]!.split("/");
        add(parts[parts.length - 1]!);
      }
    } catch {
      /* */
    }
    try {
      await stat(join(dir, "Anchor.toml"));
      add("solana");
      add("anchor");
      add("rust");
    } catch {
      /* */
    }

    // Extension scan for language detection
    try {
      const entries = await readdir(dir, { withFileTypes: true });
      for (const e of entries) {
        if (SKIP.has(e.name) || e.name.startsWith(".")) continue;
        if (e.isFile()) {
          const ext = e.name.split(".").pop()?.toLowerCase();
          if (ext === "ts" || ext === "tsx") add("typescript");
          else if (ext === "js" || ext === "jsx" || ext === "mjs" || ext === "cjs") add("javascript");
          else if (ext === "py") add("python");
          else if (ext === "rs") add("rust");
          else if (ext === "go") add("go");
          else if (ext === "sh" || ext === "bash") add("bash");
          else if (ext === "swift") add("swift");
          else if (ext === "kt") add("kotlin");
          else if (ext === "java") add("java");
          else if (ext === "rb") add("ruby");
          else if (ext === "sol") {
            add("solidity");
            add("ethereum");
          }
        } else if (e.isDirectory() && depth < 2) {
          await scanDir(join(dir, e.name), depth + 1);
        }
      }
    } catch {
      /* */
    }
  }

  await scanDir(path, 0);
  return signals;
}

/**
 * Aliases for common tech names → ecosystem-package tokens that ground truth captures.
 * Without these, "PostgreSQL" gets marked hallucinated when deps only list "pg".
 */
const TECH_ALIASES: Record<string, string[]> = {
  postgresql: ["pg", "postgres", "postgresql", "pgvector", "drizzle", "knex", "typeorm", "prisma"],
  postgres: ["pg", "postgres", "postgresql"],
  mysql: ["mysql", "mysql2", "mariadb"],
  mongodb: ["mongo", "mongodb", "mongoose"],
  redis: ["redis", "ioredis", "bull"],
  sqlite: ["sqlite", "sqlite3", "better-sqlite3"],
  telegram: ["telegram", "telegraf", "grammy", "node-telegram-bot-api"],
  "openrouter": ["openrouter", "openai"],
  openai: ["openai", "openrouter"],
  anthropic: ["anthropic", "claude"],
  twitter: ["twitter", "twitter-api-v2"],
  linkedin: ["linkedin", "linkedin-api"],
  facebook: ["facebook", "fbgraph"],
  ffmpeg: ["ffmpeg", "ffmpeg-sidecar", "fluent-ffmpeg"],
  tauri: ["tauri"],
  nestjs: ["nestjs", "nest"],
  nextjs: ["next"],
  reactnative: ["react-native", "expo"],
  vite: ["vite", "vitejs"],
  swagger: ["swagger", "openapi", "@nestjs/swagger"],
  jwt: ["jwt", "jsonwebtoken", "@nestjs/jwt", "passport-jwt"],
  prisma: ["prisma", "@prisma/client"],
};

export function scoreTechStack(
  detected: string[],
  groundTruth: Set<string>
): { score: number; hallucinated: string[] } {
  if (detected.length === 0) return { score: 0, hallucinated: [] };
  const hallucinated: string[] = [];
  let hits = 0;
  for (const item of detected) {
    const lower = item.toLowerCase().trim();
    // Direct hit
    if (groundTruth.has(lower)) {
      hits++;
      continue;
    }
    // Tokenize and check each
    const tokens = lower.split(/[\s./()-]+/).filter(Boolean);
    if (tokens.some((t) => groundTruth.has(t))) {
      hits++;
      continue;
    }
    // Alias map: look up each token / phrase against alias values
    const aliasTokens = new Set<string>([lower, ...tokens]);
    let matched = false;
    for (const t of aliasTokens) {
      const aliases = TECH_ALIASES[t];
      if (aliases && aliases.some((a) => groundTruth.has(a))) {
        matched = true;
        break;
      }
    }
    if (matched) hits++;
    else hallucinated.push(item);
  }
  return { score: hits / detected.length, hallucinated };
}

async function listInstalledModels(): Promise<Set<string>> {
  try {
    const adapter = new OllamaAdapter();
    const models = await adapter.getModels();
    return new Set(models.map((m) => m.name));
  } catch {
    return new Set();
  }
}

async function pullIfMissing(model: string, installed: Set<string>, pull: boolean): Promise<boolean> {
  if (installed.has(model)) return true;
  if (!pull) {
    console.error(`! skip ${model} (not installed; pass --pull to fetch)`);
    return false;
  }
  console.error(`> pulling ${model}...`);
  const adapter = new OllamaAdapter();
  const ok = await adapter.pullModel(model, (status, pct) => {
    if (pct > 0 && pct % 10 === 0) console.error(`  ${model}: ${status} ${pct}%`);
  });
  if (ok) {
    installed.add(model);
    console.error(`> pulled ${model}`);
  } else {
    console.error(`! failed to pull ${model}`);
  }
  return ok;
}

async function runOne(model: string, projectPath: string): Promise<ModelRun> {
  const proj = await fakeProjectFromPath(projectPath);
  const ctx = await buildProjectContext(proj);
  // Force model via env var (OllamaAdapter reads AGENT_CV_MODEL in constructor).
  const prev = process.env.AGENT_CV_MODEL;
  process.env.AGENT_CV_MODEL = model;
  const adapter = new OllamaAdapter();
  process.env.AGENT_CV_MODEL = prev;

  const groundTruth = await extractGroundTruth(projectPath);

  const t0 = Date.now();
  try {
    const analysis = await adapter.analyze(ctx);
    const latencyMs = Date.now() - t0;
    const techStack = analysis.techStack || [];
    const { score, hallucinated } = scoreTechStack(techStack, groundTruth);
    return {
      model,
      project: basename(projectPath),
      ok: true,
      jsonValid: true,
      latencyMs,
      summary: (analysis.summary || "").slice(0, 120),
      techStack,
      rawLen: (analysis.summary || "").length,
      hallucinationScore: score,
      hallucinated,
    };
  } catch (err: any) {
    const latencyMs = Date.now() - t0;
    const msg = err?.message || String(err);
    let jsonValid = true;
    if (/json|parse|brace|extract/i.test(msg)) jsonValid = false;
    return {
      model,
      project: basename(projectPath),
      ok: false,
      jsonValid,
      latencyMs,
      summary: "",
      techStack: [],
      rawLen: 0,
      hallucinationScore: 0,
      hallucinated: [],
      error: msg.slice(0, 200),
    };
  }
}

function fmtMs(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function printMarkdownTable(runs: ModelRun[], projects: string[], models: string[]): void {
  const byProject = new Map<string, Map<string, ModelRun>>();
  for (const r of runs) {
    const proj = r.project;
    if (!byProject.has(proj)) byProject.set(proj, new Map());
    byProject.get(proj)!.set(r.model, r);
  }

  // Per-project detail
  for (const p of projects) {
    const name = basename(p);
    const m = byProject.get(name);
    if (!m) continue;
    console.log(`\n## ${name}`);
    console.log(`| model | ok | json | latency | gt-score | hallucinated | techStack | summary |`);
    console.log(`|---|---|---|---|---|---|---|---|`);
    for (const model of models) {
      const r = m.get(model);
      if (!r) {
        console.log(`| ${model} | - | - | - | - | - | - | not run |`);
        continue;
      }
      const ok = r.ok ? "✓" : "✗";
      const json = r.jsonValid ? "✓" : "✗";
      const stack = r.techStack.slice(0, 5).join(", ");
      const summary = (r.summary || r.error || "").replace(/\|/g, "\\|").slice(0, 60);
      const gt = `${(r.hallucinationScore * 100).toFixed(0)}%`;
      const hal = r.hallucinated.slice(0, 3).join(", ");
      console.log(
        `| ${model} | ${ok} | ${json} | ${fmtMs(r.latencyMs)} | ${gt} | ${hal} | ${stack} | ${summary} |`
      );
    }
  }

  // Per-model aggregate
  console.log(`\n## Aggregate per model`);
  console.log(`| model | runs | ok | json valid | mean latency | median latency | mean gt-score |`);
  console.log(`|---|---|---|---|---|---|---|`);
  for (const model of models) {
    const rs = runs.filter((r) => r.model === model);
    if (rs.length === 0) continue;
    const okRuns = rs.filter((r) => r.ok);
    const json = rs.filter((r) => r.jsonValid).length;
    const lats = rs.map((r) => r.latencyMs).sort((a, b) => a - b);
    const mean = Math.round(lats.reduce((a, b) => a + b, 0) / lats.length);
    const median = lats[Math.floor(lats.length / 2)] ?? 0;
    const gt = okRuns.length
      ? `${((okRuns.reduce((s, r) => s + r.hallucinationScore, 0) / okRuns.length) * 100).toFixed(0)}%`
      : "-";
    console.log(
      `| ${model} | ${rs.length} | ${okRuns.length}/${rs.length} | ${json}/${rs.length} | ${fmtMs(mean)} | ${fmtMs(median)} | ${gt} |`
    );
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.projects.length === 0) {
    if (!args.root) {
      console.error("error: pass --projects /p1,/p2 or --root <dir> --pick N");
      process.exit(1);
    }
    args.projects = await pickProjectsFromRoot(args.root, args.pick);
  }

  if (args.projects.length === 0) {
    console.error("error: no projects to benchmark");
    process.exit(1);
  }

  console.error(`> models: ${args.models.join(", ")}`);
  console.error(`> projects (${args.projects.length}):`);
  for (const p of args.projects) console.error(`    ${p}`);

  const installed = await listInstalledModels();
  const runnable: string[] = [];
  for (const m of args.models) {
    const ok = await pullIfMissing(m, installed, args.pull);
    if (ok) runnable.push(m);
  }

  if (runnable.length === 0) {
    console.error("error: no models available. Pull manually or pass --pull.");
    process.exit(1);
  }

  const runs: ModelRun[] = [];
  for (const projectPath of args.projects) {
    for (const model of runnable) {
      console.error(`> ${model} <- ${basename(projectPath)}`);
      const r = await runOne(model, projectPath);
      runs.push(r);
      console.error(
        `  ${r.ok ? "ok" : "fail"} ${fmtMs(r.latencyMs)} json=${r.jsonValid}${r.error ? ` err=${r.error.slice(0, 80)}` : ""}`
      );
    }
  }

  // Always save raw JSON for postmortem alongside the human report.
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const outPath = `/tmp/bench-ollama-${timestamp}.json`;
  await Bun.write(outPath, JSON.stringify({ runs, projects: args.projects, models: runnable }, null, 2));
  console.error(`> raw results: ${outPath}`);

  if (args.json) {
    process.stdout.write(JSON.stringify({ runs, projects: args.projects, models: runnable }, null, 2));
  } else {
    printMarkdownTable(runs, args.projects, runnable);
  }
}

// Silence unused import warning — kept for future stricter JSON validation.
void extractFirstJsonObject;

// Run main only when invoked as a script, not when imported by tests.
if (import.meta.main) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
