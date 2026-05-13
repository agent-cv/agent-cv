#!/usr/bin/env bun
/**
 * In-place cleanup of the local inventory:
 *   1. Re-resolves displayName per project using the new scanner hierarchy
 *      (package.json name → Cargo → pyproject → git remote → parent dir → basename).
 *   2. Excludes obvious non-CV trash (/track/, /tmp/, /unpacked/, /delete/, /forks/
 *      paths and projects with no commits AND a generic basename).
 *
 * Run after `scripts/run-analyze.ts` and before `scripts/run-publish.ts` to fix
 * up an existing inventory without a full rescan.
 */
import { readFile, stat } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { readInventory, writeInventory } from "../packages/core/src/inventory/store.ts";
import { extractRemoteUrl } from "../packages/core/src/discovery/git-metadata.ts";

const GENERIC_DIR_NAMES = new Set([
  "package", "src", "lib", "dist", "build", "app", "main", "core",
  "client", "server", "frontend", "backend", "api", "web", "code",
]);

const EXCLUDE_PATH_SEGMENTS = ["/track/", "/tmp/", "/unpacked/", "/delete/", "/forks/"];

async function resolveDisplayName(dir: string, hasGit: boolean): Promise<string> {
  const fallback = basename(dir);

  try {
    const raw = await readFile(join(dir, "package.json"), "utf-8");
    const pkg = JSON.parse(raw);
    if (typeof pkg.name === "string" && pkg.name.trim()) {
      const scoped = pkg.name.match(/^@[^/]+\/(.+)$/);
      const name = (scoped ? scoped[1] : pkg.name).trim();
      if (name && !GENERIC_DIR_NAMES.has(name)) return name;
    }
  } catch {
    /* */
  }

  try {
    const raw = await readFile(join(dir, "Cargo.toml"), "utf-8");
    const m = raw.match(/^\s*\[package\][\s\S]*?^\s*name\s*=\s*"([^"]+)"/m);
    if (m && m[1]) return m[1];
  } catch {
    /* */
  }

  try {
    const raw = await readFile(join(dir, "pyproject.toml"), "utf-8");
    const project = raw.match(/^\s*\[project\][\s\S]*?^\s*name\s*=\s*"([^"]+)"/m);
    if (project && project[1]) return project[1];
    const poetry = raw.match(/^\s*\[tool\.poetry\][\s\S]*?^\s*name\s*=\s*"([^"]+)"/m);
    if (poetry && poetry[1]) return poetry[1];
  } catch {
    /* */
  }

  if (hasGit) {
    try {
      const remote = await extractRemoteUrl(dir);
      if (remote) {
        const m = remote.match(/[/:]([^/:]+?)(?:\.git)?\/?$/);
        if (m && m[1] && !GENERIC_DIR_NAMES.has(m[1])) return m[1];
      }
    } catch {
      /* */
    }
  }

  if (GENERIC_DIR_NAMES.has(fallback)) {
    const parent = basename(dirname(dir));
    if (parent && parent !== "/" && parent !== "." && !GENERIC_DIR_NAMES.has(parent)) {
      return parent;
    }
  }

  return fallback;
}

async function pathStillExists(p: string): Promise<boolean> {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

async function main() {
  const inv = await readInventory();
  console.error(`> ${inv.projects.length} projects in inventory`);

  let renamed = 0;
  let excluded = 0;
  let missing = 0;

  for (const p of inv.projects) {
    // Re-resolve displayName from manifests
    const exists = await pathStillExists(p.path);
    if (!exists) {
      // Path gone — keep entry but mark removed (don't fail loop)
      if (!p.tags.includes("removed")) p.tags.push("removed");
      missing++;
      continue;
    }
    const newName = await resolveDisplayName(p.path, p.hasGit);
    if (newName !== p.displayName) {
      p.displayName = newName;
      p.nameSource = "directory";
      renamed++;
    }

    // Exclude trash dirs
    const inTrashDir = EXCLUDE_PATH_SEGMENTS.some((seg) => p.path.includes(seg));
    if (inTrashDir && p.included !== false) {
      p.included = false;
      excluded++;
    }
  }

  console.error(`> renamed: ${renamed}`);
  console.error(`> excluded as trash dir: ${excluded}`);
  console.error(`> missing path (tagged removed): ${missing}`);

  await writeInventory(inv);
  console.error(`> inventory persisted`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
