/**
 * Centralized GitHub API client with auth, rate limiting, and retry.
 * Used by github-scanner (cloud listing) and enrichGitHubData() (GET /repos batch).
 *
 *   ┌────────────┐     ┌──────────────┐     ┌─────────────┐
 *   │ github-    │────▶│ Rate limit   │────▶│ GitHub API  │
 *   │ scanner.ts │     │ tracker      │     │             │
 *   ├────────────┤     │              │     │ 5000 req/hr │
 *   │ enrich     │────▶│ Retry on 429 │────▶│ with token  │
 *   │ GitHubData │     │ Auth header  │     │             │
 *   └────────────┘     └──────────────┘     └─────────────┘
 */

export class GitHubClient {
  private token: string | undefined;
  private remaining: number = -1;
  private resetAt: number = 0;
  private rateLimited: boolean = false;

  constructor(token?: string) {
    this.token = token || process.env.GITHUB_TOKEN;
  }

  /** Create client with token from GITHUB_TOKEN env or saved credentials (see resolveGitHubToken). */
  static async create(): Promise<GitHubClient> {
    const { resolveGitHubToken } = await import("../auth/credentials.ts");
    const token = await resolveGitHubToken();
    return new GitHubClient(token || undefined);
  }

  get isAuthenticated(): boolean {
    return !!this.token;
  }

  get remainingRequests(): number {
    return this.remaining;
  }

  get isRateLimited(): boolean {
    return this.rateLimited;
  }

  /**
   * Make an authenticated GET request to the GitHub API.
   * Handles rate limiting, retry on 429, and common error codes.
   */
  async get<T = any>(path: string): Promise<T> {
    if (this.rateLimited) {
      const waitMs = (this.resetAt * 1000) - Date.now();
      if (waitMs > 0) {
        throw new GitHubRateLimitError(this.remaining, this.resetAt);
      }
      this.rateLimited = false;
    }

    const url = path.startsWith("http") ? path : `https://api.github.com${path}`;
    const headers: Record<string, string> = {
      "Accept": "application/vnd.github.v3+json",
      "User-Agent": "agent-cv",
    };
    if (this.token) {
      headers["Authorization"] = `Bearer ${this.token}`;
    }

    let lastError: Error | null = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const res = await fetch(url, { headers, redirect: "follow" });

        // Update rate limit tracking from response headers
        const remaining = res.headers.get("x-ratelimit-remaining");
        const reset = res.headers.get("x-ratelimit-reset");
        if (remaining !== null) this.remaining = parseInt(remaining, 10);
        if (reset !== null) this.resetAt = parseInt(reset, 10);

        if (remaining === "0") {
          this.rateLimited = true;
        }

        if (res.status === 200) {
          return await res.json() as T;
        }

        if (res.status === 401) {
          throw new GitHubAuthError("Invalid GITHUB_TOKEN. See: https://github.com/settings/tokens");
        }

        if (res.status === 403 && this.rateLimited) {
          throw new GitHubRateLimitError(this.remaining, this.resetAt);
        }

        if (res.status === 404) {
          throw new GitHubNotFoundError(path);
        }

        if (res.status === 429) {
          const retryAfter = parseInt(res.headers.get("retry-after") || "60", 10);
          if (attempt < 2) {
            await new Promise(r => setTimeout(r, retryAfter * 1000));
            continue;
          }
          throw new GitHubRateLimitError(0, Math.floor(Date.now() / 1000) + retryAfter);
        }

        // Other errors
        const body = await res.text().catch(() => "");
        throw new Error(`GitHub API ${res.status}: ${body.slice(0, 200)}`);
      } catch (err: any) {
        if (err instanceof GitHubAuthError || err instanceof GitHubNotFoundError) {
          throw err;
        }
        if (err instanceof GitHubRateLimitError && attempt >= 2) {
          throw err;
        }
        lastError = err;
        if (attempt < 2 && isTransient(err.message)) {
          await new Promise(r => setTimeout(r, 2000 * (attempt + 1)));
          continue;
        }
        throw err;
      }
    }
    throw lastError || new Error("GitHub API: unreachable");
  }

  /**
   * GET with 404 returning null instead of throwing.
   */
  async getOrNull<T = any>(path: string): Promise<T | null> {
    try {
      return await this.get<T>(path);
    } catch (err) {
      if (err instanceof GitHubNotFoundError) return null;
      throw err;
    }
  }

  /**
   * Fetch all pages of a paginated GitHub API endpoint.
   *
   * Strategy: fetch page 1, then if a `Link rel=last` is present, fan out
   * pages 2..N in parallel. Falls back to serial Link-rel=next walking
   * for endpoints that don't expose `last` (e.g. Events API).
   */
  async paginate<T = any>(path: string, maxPages: number = 20): Promise<T[]> {
    const PAGE_CONCURRENCY = 6;
    const initialUrl = path.includes("?") ? `${path}&per_page=100` : `${path}?per_page=100`;

    const fetchPage = async (
      url: string
    ): Promise<{ data: T[]; nextUrl: string; lastPage: number | null }> => {
      const fullUrl = url.startsWith("http") ? url : `https://api.github.com${url}`;
      const headers: Record<string, string> = {
        "Accept": "application/vnd.github.v3+json",
        "User-Agent": "agent-cv",
      };
      if (this.token) headers["Authorization"] = `Bearer ${this.token}`;

      const res = await fetch(fullUrl, { headers, redirect: "follow" });

      const remaining = res.headers.get("x-ratelimit-remaining");
      const reset = res.headers.get("x-ratelimit-reset");
      if (remaining !== null) this.remaining = parseInt(remaining, 10);
      if (reset !== null) this.resetAt = parseInt(reset, 10);
      if (remaining === "0") this.rateLimited = true;

      if (!res.ok) {
        if (res.status === 401) throw new GitHubAuthError("Invalid GITHUB_TOKEN");
        if (res.status === 403 && this.rateLimited) {
          throw new GitHubRateLimitError(this.remaining, this.resetAt);
        }
        return { data: [], nextUrl: "", lastPage: null };
      }

      const data = (await res.json()) as T[];
      const link = res.headers.get("link");
      const nextMatch = link?.match(/<([^>]+)>;\s*rel="next"/);
      const lastMatch = link?.match(/<([^>]+page=(\d+)[^>]*)>;\s*rel="last"/);
      const lastPage = lastMatch?.[2] ? parseInt(lastMatch[2], 10) : null;
      return {
        data: Array.isArray(data) ? data : [],
        nextUrl: nextMatch ? nextMatch[1]! : "",
        lastPage,
      };
    };

    // First page tells us total page count (if endpoint supports it).
    const first = await fetchPage(initialUrl);
    if (first.data.length === 0) return [];

    const totalPages = first.lastPage ? Math.min(first.lastPage, maxPages) : null;

    // Fast path: known total → parallel fetch of pages 2..totalPages
    if (totalPages !== null && totalPages >= 2) {
      const pageNumbers: number[] = [];
      for (let p = 2; p <= totalPages; p++) pageNumbers.push(p);

      const buildPageUrl = (n: number): string => {
        const sep = initialUrl.includes("?") ? "&" : "?";
        return `${initialUrl}${sep}page=${n}`;
      };

      const results: T[][] = new Array(totalPages);
      results[0] = first.data;

      let cursor = 0;
      const worker = async () => {
        while (cursor < pageNumbers.length) {
          const idx = cursor++;
          const pageNum = pageNumbers[idx]!;
          try {
            const r = await fetchPage(buildPageUrl(pageNum));
            results[pageNum - 1] = r.data;
          } catch (err) {
            if (err instanceof GitHubAuthError) throw err;
            results[pageNum - 1] = [];
          }
        }
      };
      await Promise.all(
        Array.from({ length: Math.min(PAGE_CONCURRENCY, pageNumbers.length) }, () => worker())
      );

      return results.flat();
    }

    // Slow path: no `last` rel — walk Link rel=next serially (e.g. Events API).
    const all: T[] = [...first.data];
    let nextUrl = first.nextUrl;
    let page = 1;
    while (nextUrl && page < maxPages) {
      try {
        const r = await fetchPage(nextUrl);
        if (r.data.length === 0) break;
        all.push(...r.data);
        nextUrl = r.nextUrl;
        page++;
      } catch (err) {
        if (err instanceof GitHubAuthError) throw err;
        break;
      }
    }
    return all;
  }
}

function isTransient(message: string): boolean {
  const lower = message.toLowerCase();
  return ["timeout", "econnreset", "econnrefused", "etimedout", "fetch failed", "network"].some(
    p => lower.includes(p)
  );
}

export class GitHubAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GitHubAuthError";
  }
}

export class GitHubRateLimitError extends Error {
  remaining: number;
  resetAt: number;
  constructor(remaining: number, resetAt: number) {
    const resetDate = new Date(resetAt * 1000);
    super(`GitHub API rate limited. Resets at ${resetDate.toLocaleTimeString()}`);
    this.name = "GitHubRateLimitError";
    this.remaining = remaining;
    this.resetAt = resetAt;
  }
}

export class GitHubNotFoundError extends Error {
  constructor(path: string) {
    super(`GitHub API 404: ${path}`);
    this.name = "GitHubNotFoundError";
  }
}
