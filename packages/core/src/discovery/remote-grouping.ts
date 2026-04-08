/**
 * Group projects by Git host namespace + logical repo stem (e.g. org/foo-api + org/foo-web → "foo").
 * Complements filesystem-based detectProjectGroups for repos in different local folders.
 */

import type { Project } from "../types.ts";

/** Role / stack suffixes stripped from repo names to find a shared product stem */
const REPO_ROLE_SUFFIX =
  /[-_](?:web|www|api|bff|frontend|backend|server|client|ui|mobile|ios|android|apps?|workers?|worker|extension|ext|site|dashboard|admin|desktop|cli|sdk|core|db|infra|terraform|k8s|helm)$/i;

export interface ParsedRemote {
  /** Full path before repo segment, lowercased (e.g. "acme" or "acme/team") */
  namespace: string;
  /** Repository name without .git */
  repo: string;
}

/**
 * Parse https / ssh URLs for GitHub, GitLab, Gitea-style paths: .../namespace/.../repo
 */
export function parseGitRemote(url: string | undefined): ParsedRemote | null {
  if (!url?.trim()) return null;
  const raw = url.trim();

  let pathStr: string | null = null;
  const ssh = raw.match(/^git@[^:]+:(.+)$/i);
  if (ssh) {
    pathStr = ssh[1]!.replace(/\.git$/i, "");
  } else {
    try {
      const u = new URL(raw.replace(/^git:\/\//i, "https://"));
      const host = u.hostname.replace(/^www\./i, "");
      if (!host || u.pathname.length < 2) return null;
      pathStr = u.pathname.replace(/^\/+/, "").replace(/\.git$/i, "");
    } catch {
      return null;
    }
  }

  const segments = pathStr.split("/").filter(Boolean);
  if (segments.length < 2) return null;

  const repo = segments.pop()!;
  const namespace = segments.join("/");
  return { namespace: namespace.toLowerCase(), repo };
}

/**
 * Strip trailing role segments (e.g. myapp-web → myapp) for grouping keys.
 */
export function repoStemForGrouping(repo: string): string {
  let name = repo.replace(/\.git$/i, "");
  let prev = "";
  while (name !== prev && name.length > 0) {
    prev = name;
    const next = name.replace(REPO_ROLE_SUFFIX, "");
    if (next === name) break;
    name = next;
  }
  return name.toLowerCase() || repo.replace(/\.git$/i, "").toLowerCase();
}

/**
 * Assign projectGroup from remotes when 2+ projects share namespace + stem.
 * Projects that already have a group (e.g. from filesystem detection) still count
 * toward the pair threshold so a sibling without a group gets the remote label.
 * Never overwrites an existing projectGroup.
 */
export function detectProjectGroupsFromRemotes(projects: Project[]): void {
  const bucket = new Map<string, Project[]>();

  for (const p of projects) {
    const parsed = parseGitRemote(p.remoteUrl);
    if (!parsed) continue;
    const stem = repoStemForGrouping(parsed.repo);
    if (!stem) continue;
    const key = `${parsed.namespace}::${stem}`;
    if (!bucket.has(key)) bucket.set(key, []);
    bucket.get(key)!.push(p);
  }

  for (const [key, members] of bucket) {
    if (members.length < 2) continue;
    const stem = key.split("::")[1] ?? key;
    for (const p of members) {
      if (!p.projectGroup) {
        p.projectGroup = stem;
      }
    }
  }
}
