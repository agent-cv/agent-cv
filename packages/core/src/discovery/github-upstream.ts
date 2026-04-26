/**
 * Count PRs authored by the user on a fork's parent repo (upstream contribution signal).
 * Uses GitHub search API — requires auth for sane rate limits.
 */

import { GitHubClient } from "./github-client.ts";
import type { Project } from "../types.ts";

interface SearchIssuesResponse {
  total_count: number;
  incomplete_results?: boolean;
}

/**
 * For each fork with githubParentFullName, set upstreamPrCount = number of PRs
 * authored by `githubLogin` on the parent repository.
 * Deduplicates search queries per (parent, author).
 */
export async function enrichUpstreamPullRequestCounts(
  projects: Project[],
  client: GitHubClient,
  githubLogin: string | undefined,
  signal?: AbortSignal
): Promise<void> {
  const login = githubLogin?.trim();
  if (!login) return;

  // GitHub Search API has a separate, tighter rate limit (30 req/min authenticated).
  // Stay conservative on concurrency; group by unique (parent, login) so we
  // never hit the API twice for the same query even when many forks share parent.
  const SEARCH_CONCURRENCY = 5;

  const forksNeedingCount = projects.filter(
    (p) => p.isFork && p.githubParentFullName && p.remoteUrl?.includes("github.com")
  );
  if (forksNeedingCount.length === 0) return;

  // Build the unique work set: one query per distinct parent.
  const uniqueParents = new Map<string, string>(); // key -> parent fullname
  for (const p of forksNeedingCount) {
    const parent = p.githubParentFullName!;
    const key = `${parent.toLowerCase()}::${login.toLowerCase()}`;
    if (!uniqueParents.has(key)) uniqueParents.set(key, parent);
  }

  const counts = new Map<string, number>();
  const entries = [...uniqueParents.entries()];

  // Run searches in parallel with a small pool.
  let cursor = 0;
  async function worker() {
    while (cursor < entries.length) {
      signal?.throwIfAborted();
      const idx = cursor++;
      const [key, parent] = entries[idx]!;
      try {
        const q = `repo:${parent} is:pr author:${login}`;
        const path = `/search/issues?q=${encodeURIComponent(q)}&per_page=1`;
        const data = await client.get<SearchIssuesResponse>(path);
        counts.set(key, typeof data.total_count === "number" ? data.total_count : 0);
      } catch {
        counts.set(key, 0);
      }
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(SEARCH_CONCURRENCY, entries.length) }, () => worker())
  );

  // Assign results back to every fork sharing a (parent, login) key.
  for (const p of forksNeedingCount) {
    const key = `${p.githubParentFullName!.toLowerCase()}::${login.toLowerCase()}`;
    p.upstreamPrCount = counts.get(key) ?? 0;
  }
}
