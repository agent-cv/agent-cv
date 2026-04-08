import { GitHubClient, GitHubAuthError } from "../discovery/github-client.ts";
import { scanGitHub, type GitHubScanResult } from "../discovery/github-scanner.ts";
import { mergeCloudProjects, writeInventory } from "../inventory/store.ts";
import { searchPackageRegistries } from "../discovery/package-registries.ts";
import type { Inventory, Project } from "../types.ts";

/**
 * Injectable dependencies for tests (mock GitHubClient factory and IO).
 */
export interface GitHubCloudPhaseDeps {
  createGitHubClient: () => Promise<GitHubClient>;
  scanGitHub: typeof scanGitHub;
  mergeCloudProjects: typeof mergeCloudProjects;
  writeInventory: typeof writeInventory;
  searchPackageRegistries: typeof searchPackageRegistries;
}

const defaultDeps: GitHubCloudPhaseDeps = {
  createGitHubClient: () => GitHubClient.create(),
  scanGitHub,
  mergeCloudProjects,
  writeInventory,
  searchPackageRegistries,
};

export interface GitHubCloudPhaseInput {
  inventory: Inventory;
  projects: Project[];
  ghUser: string;
  includeForks?: boolean;
}

export interface GitHubCloudPhaseCallbacks {
  onStatus: (message: string) => void;
  onGitHubProgress?: (done: number, total: number, name: string) => void;
  onGitHubScanComplete?: (
    durationMs: number,
    meta: { cloud_repos: number }
  ) => void | Promise<void>;
  onPackageRegistrySearchComplete?: (
    durationMs: number,
    meta: { packages_found: number }
  ) => void | Promise<void>;
}

export interface GitHubCloudPhaseResult {
  inventory: Inventory;
  projects: Project[];
  /** True when cloud scan merged into inventory and persisted (or attempted full path). */
  applied: boolean;
  ghResult?: GitHubScanResult;
}

/**
 * GitHub cloud listing + profile extras + optional package-registry search, merged into scan results.
 * Best-effort: auth missing or scan failure returns local-only data with applied: false.
 */
export async function mergeGitHubCloudIntoScanResult(
  input: GitHubCloudPhaseInput,
  callbacks: GitHubCloudPhaseCallbacks,
  deps: Partial<GitHubCloudPhaseDeps> = {}
): Promise<GitHubCloudPhaseResult> {
  const d = { ...defaultDeps, ...deps };
  const { ghUser, includeForks } = input;
  let { inventory, projects } = input;

  const ghClient = await d.createGitHubClient();
  if (!ghClient.isAuthenticated) {
    callbacks.onStatus(
      "Skipping GitHub scan — set GITHUB_TOKEN or credentials.githubToken"
    );
    return { inventory, projects, applied: false };
  }

  try {
    callbacks.onStatus(`Scanning GitHub repos for ${ghUser}...`);
    const ghScanStarted = Date.now();
    const ghResult = await d.scanGitHub(ghUser, ghClient, {
      includeForks,
      onProgress: callbacks.onGitHubProgress,
    });
    await callbacks.onGitHubScanComplete?.(Date.now() - ghScanStarted, {
      cloud_repos: ghResult.projects.length,
    });

    inventory = d.mergeCloudProjects(inventory, ghResult.projects);
    projects = inventory.projects.filter((p) => !p.tags.includes("removed"));

    if (ghResult.profile) {
      inventory.profile.name =
        inventory.profile.name || ghResult.profile.name || undefined;
      if (ghResult.profile.bio) {
        inventory.profile.socials = {
          ...inventory.profile.socials,
          github: ghUser,
          website:
            inventory.profile.socials?.website ||
            ghResult.profile.blog ||
            undefined,
        };
      }
    }

    if (ghResult.starredRepos.length > 0 || ghResult.contributions.length > 0) {
      inventory.githubExtras = {
        starredRepos: ghResult.starredRepos.slice(0, 200),
        contributions: ghResult.contributions,
        avatarUrl: ghResult.profile?.avatar_url,
      };
    }

    try {
      callbacks.onStatus("Searching package registries...");
      const pkgStarted = Date.now();
      const packages = await d.searchPackageRegistries(ghUser, (_registry, error) => {
        callbacks.onStatus(`Warning: ${error}`);
      });
      await callbacks.onPackageRegistrySearchComplete?.(Date.now() - pkgStarted, {
        packages_found: packages.length,
      });
      if (packages.length > 0) {
        inventory.publishedPackages = packages;
      }
    } catch {
      // Package registries are best-effort
    }

    await d.writeInventory(inventory);

    if (ghResult.errors.length > 0) {
      for (const err of ghResult.errors) {
        callbacks.onStatus(`Warning: ${err.context} — ${err.error}`);
      }
    }

    callbacks.onStatus(
      `GitHub: found ${ghResult.projects.length} repos, ${ghResult.starredRepos.length} starred`
    );

    return { inventory, projects, applied: true, ghResult };
  } catch (err: any) {
    if (err instanceof GitHubAuthError) {
      callbacks.onStatus(`GitHub auth failed: ${err.message}`);
    } else {
      callbacks.onStatus(`GitHub scan failed: ${err.message}`);
    }
    return { inventory, projects, applied: false };
  }
}
