import { describe, it, expect } from "bun:test";
import { GitHubAuthError } from "@agent-cv/core/src/discovery/github-client.ts";
import type { GitHubScanResult } from "@agent-cv/core/src/discovery/github-scanner.ts";
import { mergeCloudProjects } from "@agent-cv/core/src/inventory/store.ts";
import { mergeGitHubCloudIntoScanResult } from "@agent-cv/core/src/pipeline/github-cloud-phase.ts";
import type { Inventory, Project } from "@agent-cv/core/src/types.ts";
import type { GitHubClient } from "@agent-cv/core/src/discovery/github-client.ts";

function makeProject(overrides: Partial<Project>): Project {
  return {
    id: "test-id",
    path: "/test/project",
    displayName: "test-project",
    type: "node",
    language: "TypeScript",
    frameworks: [],
    dateRange: { start: "2024-01-01", end: "2024-06-01", approximate: false },
    hasGit: true,
    commitCount: 50,
    authorCommitCount: 30,
    hasUncommittedChanges: false,
    markers: ["package.json"],
    size: { files: 20, lines: 1000 },
    tags: [],
    included: true,
    ...overrides,
  };
}

function makeInventory(projects: Project[]): Inventory {
  return {
    version: "1.0",
    lastScan: "",
    scanPaths: ["/test"],
    projects,
    profile: { emails: [], emailsConfirmed: false },
    insights: {},
  };
}

function mockClient(authenticated: boolean): GitHubClient {
  return {
    get isAuthenticated() {
      return authenticated;
    },
  } as GitHubClient;
}

describe("mergeGitHubCloudIntoScanResult", () => {
  it("skips cloud merge when client is not authenticated", async () => {
    const local = makeProject({
      id: "l1",
      remoteUrl: "https://github.com/u/local",
    });
    const inv = makeInventory([local]);
    const statuses: string[] = [];

    const out = await mergeGitHubCloudIntoScanResult(
      { inventory: inv, projects: [local], ghUser: "u" },
      { onStatus: (m) => statuses.push(m) },
      {
        createGitHubClient: async () => mockClient(false),
      }
    );

    expect(out.applied).toBe(false);
    expect(out.inventory.projects).toHaveLength(1);
    expect(statuses.some((s) => s.includes("Skipping GitHub scan"))).toBe(true);
  });

  it("merges scan results, persists inventory, and reports completion", async () => {
    const local = makeProject({
      id: "l1",
      remoteUrl: "https://github.com/u/local",
    });
    const inv = makeInventory([local]);
    const cloudProj = makeProject({
      id: "c1",
      path: "",
      remoteUrl: "https://github.com/u/cloud-only",
      source: "github",
    });

    const scanResult: GitHubScanResult = {
      projects: [cloudProj],
      profile: {
        login: "u",
        name: "User Name",
        bio: "builder",
        avatar_url: "https://avatars.githubusercontent.com/u/1",
        company: null,
        location: null,
        blog: "https://example.com",
        twitter_username: null,
        public_repos: 5,
      },
      starredRepos: [{ name: "s", description: null, language: null, stars: 1, url: "https://github.com/x/s" }],
      contributions: [],
      errors: [],
    };

    let written: Inventory | null = null;
    const statuses: string[] = [];

    const out = await mergeGitHubCloudIntoScanResult(
      { inventory: inv, projects: inv.projects, ghUser: "u" },
      {
        onStatus: (m) => statuses.push(m),
        onGitHubScanComplete: async (_ms, meta) => {
          expect(meta.cloud_repos).toBe(1);
        },
        onPackageRegistrySearchComplete: async (_ms, meta) => {
          expect(meta.packages_found).toBe(0);
        },
      },
      {
        createGitHubClient: async () => mockClient(true),
        scanGitHub: async () => scanResult,
        mergeCloudProjects,
        writeInventory: async (i) => {
          written = i;
        },
        searchPackageRegistries: async () => [],
      }
    );

    expect(out.applied).toBe(true);
    expect(out.inventory.projects.some((p) => p.id === "c1")).toBe(true);
    expect(written).not.toBeNull();
    expect(written!.githubExtras?.starredRepos.length).toBe(1);
    expect(written!.profile.socials?.github).toBe("u");
    expect(statuses.some((s) => s.includes("repos, 1 starred"))).toBe(true);
  });

  it("returns applied false and preserves inventory on GitHubAuthError from scan", async () => {
    const local = makeProject({ id: "l1" });
    const inv = makeInventory([local]);
    let writeCalls = 0;

    const out = await mergeGitHubCloudIntoScanResult(
      { inventory: inv, projects: [local], ghUser: "u" },
      { onStatus: () => {} },
      {
        createGitHubClient: async () => mockClient(true),
        scanGitHub: async () => {
          throw new GitHubAuthError("bad token");
        },
        mergeCloudProjects,
        writeInventory: async () => {
          writeCalls++;
        },
        searchPackageRegistries: async () => [],
      }
    );

    expect(out.applied).toBe(false);
    expect(writeCalls).toBe(0);
    expect(out.inventory.projects).toHaveLength(1);
  });
});
