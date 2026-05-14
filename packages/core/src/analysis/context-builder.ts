import { readdir, readFile } from "node:fs/promises";
import { join, relative } from "node:path";
import simpleGit from "simple-git";
import type { Project, ProjectContext } from "../types.ts";

/**
 * Token budget per context section.
 * Approximate: 1 token ~ 4 characters.
 */
const BUDGET = {
  readme: 4000, // ~1K tokens
  dependencies: 2000, // ~500 tokens
  tree: 2000, // ~500 tokens
  shortlog: 2000, // ~500 tokens
  commits: 6000, // ~1.5K tokens
};

/**
 * Build the context payload for LLM analysis.
 * Collects README, deps, tree, git info from a project directory.
 * Respects privacy audit exclusions.
 */
export async function buildProjectContext(
  project: Project
): Promise<ProjectContext> {
  const dir = project.path;
  const excluded = new Set(project.privacyAudit?.excludedFiles ?? []);

  const readme = await getReadme(dir, excluded);
  const dependencies = await getDependencies(dir, excluded);
  const directoryTree = await getDirectoryTree(dir, excluded);
  const gitShortlog = project.hasGit ? await getGitShortlog(dir) : "";
  const recentCommits = project.hasGit ? await getRecentCommits(dir) : "";

  return {
    path: dir,
    readme,
    dependencies,
    directoryTree,
    gitShortlog,
    recentCommits,
    previousAnalysis: project.analysis,
    isOwner: project.isOwner,
    authorCommitCount: project.authorCommitCount,
    commitCount: project.commitCount,
    displayName: project.displayName,
  };
}

async function getReadme(
  dir: string,
  excluded: Set<string>
): Promise<string> {
  // Order matters: many monorepos ship an almost-empty README.md and put the
  // real description in CLAUDE.md or AGENTS.md (agent guidance files
  // increasingly carry the canonical "what is this repo" intro). Try those
  // before falling through to README. ARCHITECTURE.md and CONTRIBUTING.md
  // are last-resort fallbacks when nothing else exists.
  const candidates = [
    "CLAUDE.md",
    "AGENTS.md",
    "README.md",
    "README",
    "readme.md",
    "README.rst",
    "ARCHITECTURE.md",
    "CONTRIBUTING.md",
  ];
  const pieces: string[] = [];
  let budget = BUDGET.readme;
  for (const name of candidates) {
    if (excluded.has(name) || budget <= 0) continue;
    try {
      const content = await readFile(join(dir, name), "utf-8");
      // Skip near-empty files (single-line "TODO" or just a heading) so they
      // don't crowd out the real description.
      if (content.trim().length < 60) continue;
      const slice = truncate(content, Math.min(budget, BUDGET.readme));
      pieces.push(`### ${name}\n${slice}`);
      budget -= slice.length;
      // Stop once we have ~2 substantial sources; more dilutes the prompt.
      if (pieces.length >= 2) break;
    } catch {
      continue;
    }
  }
  return pieces.join("\n\n");
}

async function getDependencies(
  dir: string,
  excluded: Set<string>
): Promise<string> {
  const rootResult = await readManifestAt(dir, excluded);
  if (rootResult) return rootResult;

  // Monorepo fallback: no manifest at the root, but the real packages live
  // one or two levels down (apps/*, packages/*, services/*, ...). Walk a
  // shallow set of conventional workspace dirs and aggregate the first few
  // child manifests so the LLM sees the actual stack.
  const aggregated = await readWorkspaceManifests(dir, excluded);
  return aggregated;
}

/** Try to read a single manifest at `dir`. Returns "" when none found. */
async function readManifestAt(dir: string, excluded: Set<string>): Promise<string> {
  // Try package.json first — structured extract (name/desc/deps only) keeps
  // the prompt focused on libraries instead of build metadata.
  if (!excluded.has("package.json")) {
    try {
      const pkg = await readFile(join(dir, "package.json"), "utf-8");
      const parsed = JSON.parse(pkg);
      const deps = {
        name: parsed.name,
        description: parsed.description,
        dependencies: Object.keys(parsed.dependencies ?? {}),
        devDependencies: Object.keys(parsed.devDependencies ?? {}),
      };
      return truncate(JSON.stringify(deps, null, 2), BUDGET.dependencies);
    } catch {
      /* fall through */
    }
  }

  const manifests = [
    "Anchor.toml",
    "foundry.toml",
    "hardhat.config.ts",
    "hardhat.config.js",
    "Cargo.toml",
    "go.mod",
    "pyproject.toml",
    "requirements.txt",
    "setup.py",
    "Gemfile",
    "composer.json",
    "pubspec.yaml",
    "Package.swift",
    "mix.exs",
    "build.gradle.kts",
    "build.gradle",
    "pom.xml",
  ];
  for (const name of manifests) {
    if (excluded.has(name)) continue;
    try {
      const content = await readFile(join(dir, name), "utf-8");
      return truncate(content, BUDGET.dependencies);
    } catch {
      /* */
    }
  }
  return "";
}

const WORKSPACE_DIRS = ["apps", "packages", "services", "crates", "modules"];

/**
 * Walk shallow workspace dirs and collect 2-3 child manifests so monorepo
 * projects without a root manifest still surface their actual stack.
 */
async function readWorkspaceManifests(rootDir: string, excluded: Set<string>): Promise<string> {
  const pieces: string[] = [];
  let budget = BUDGET.dependencies;

  for (const ws of WORKSPACE_DIRS) {
    if (budget <= 0) break;
    let entries;
    try {
      entries = await readdir(join(rootDir, ws), { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      if (!e.isDirectory() || e.name.startsWith(".")) continue;
      if (budget <= 0) break;
      const sub = join(rootDir, ws, e.name);
      const childManifest = await readManifestAt(sub, excluded);
      if (childManifest) {
        const label = `# ${ws}/${e.name}`;
        const slice = truncate(childManifest, Math.min(budget - label.length - 2, 600));
        pieces.push(`${label}\n${slice}`);
        budget -= slice.length + label.length + 2;
        if (pieces.length >= 4) break;
      }
    }
    if (pieces.length >= 4) break;
  }
  return pieces.join("\n\n");
}

async function getDirectoryTree(
  dir: string,
  excluded: Set<string>
): Promise<string> {
  const lines: string[] = [];
  const SKIP = new Set([
    "node_modules", ".git", "dist", "build", "vendor",
    "__pycache__", ".next", "target", ".venv", "coverage",
  ]);

  async function walk(path: string, prefix: string, depth: number) {
    if (depth > 2) return;
    try {
      const entries = await readdir(path, { withFileTypes: true });
      const sorted = entries
        .filter((e) => !SKIP.has(e.name) && !excluded.has(e.name))
        .sort((a, b) => {
          if (a.isDirectory() !== b.isDirectory()) {
            return a.isDirectory() ? -1 : 1;
          }
          return a.name.localeCompare(b.name);
        });

      for (const entry of sorted) {
        const isLast = entry === sorted[sorted.length - 1];
        const connector = isLast ? "└── " : "├── ";
        const suffix = entry.isDirectory() ? "/" : "";
        lines.push(`${prefix}${connector}${entry.name}${suffix}`);

        if (entry.isDirectory() && depth < 2) {
          const newPrefix = prefix + (isLast ? "    " : "│   ");
          await walk(join(path, entry.name), newPrefix, depth + 1);
        }
      }
    } catch {
      // Can't read directory
    }
  }

  await walk(dir, "", 0);
  return truncate(lines.join("\n"), BUDGET.tree);
}

async function getGitShortlog(dir: string): Promise<string> {
  try {
    const git = simpleGit(dir);
    const shortlog = await git.raw(["shortlog", "-sn", "--no-merges", "HEAD"]);
    return truncate(shortlog, BUDGET.shortlog);
  } catch {
    return "";
  }
}

async function getRecentCommits(dir: string): Promise<string> {
  try {
    const git = simpleGit(dir);
    const log = await git.raw([
      "log",
      "--oneline",
      "--no-merges",
      "-50",
    ]);
    return truncate(log, BUDGET.commits);
  } catch {
    return "";
  }
}

function truncate(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  return text.slice(0, maxChars) + "\n...(truncated)";
}
