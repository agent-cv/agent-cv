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

  const cache = new Map<string, number>();

  const forksNeedingCount = projects.filter(
    (p) => p.isFork && p.githubParentFullName && p.remoteUrl?.includes("github.com")
  );

  for (const p of forksNeedingCount) {
    signal?.throwIfAborted();
    const parent = p.githubParentFullName!;
    const key = `${parent.toLowerCase()}::${login.toLowerCase()}`;
    if (cache.has(key)) {
      p.upstreamPrCount = cache.get(key)!;
      continue;
    }

    let count = 0;
    try {
      const q = `repo:${parent} is:pr author:${login}`;
      const path = `/search/issues?q=${encodeURIComponent(q)}&per_page=1`;
      const data = await client.get<SearchIssuesResponse>(path);
      count = typeof data.total_count === "number" ? data.total_count : 0;
    } catch {
      count = 0;
    }
    cache.set(key, count);
    p.upstreamPrCount = count;
  }
}
