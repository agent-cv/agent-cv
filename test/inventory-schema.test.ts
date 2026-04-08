import { describe, test, expect } from "bun:test";
import { parseInventoryJson } from "@agent-cv/core/src/inventory/inventory-schema.ts";
import { mergeInventory } from "@agent-cv/core/src/inventory/store.ts";
import type { Inventory, Project } from "@agent-cv/core/src/types.ts";

const baseInventory = (): Inventory => ({
  version: "1.0",
  lastScan: "2024-01-01",
  scanPaths: ["/tmp"],
  projects: [],
  profile: { emails: [], emailsConfirmed: false },
  insights: {},
});

function minimalProject(overrides: Partial<Project> = {}): Project {
  return {
    id: "p1",
    path: "/tmp/p1",
    displayName: "p1",
    type: "node",
    language: "TypeScript",
    frameworks: [],
    dateRange: { start: "2024-01-01", end: "2024-06-01", approximate: false },
    hasGit: true,
    commitCount: 1,
    authorCommitCount: 1,
    hasUncommittedChanges: false,
    markers: [],
    size: { files: 1, lines: 1 },
    tags: [],
    included: true,
    ...overrides,
  };
}

describe("parseInventoryJson", () => {
  test("accepts minimal valid inventory", () => {
    const inv = parseInventoryJson({
      version: "1.0",
      lastScan: "2024-01-01",
      scanPaths: [],
      projects: [{ id: "a", path: "/a", extra: true }],
      profile: { emails: [], emailsConfirmed: false },
      insights: {},
    });
    expect(inv.version).toBe("1.0");
    expect(inv.projects[0]!.id).toBe("a");
    expect((inv.projects[0] as { extra?: boolean }).extra).toBe(true);
  });

  test("accepts githubExtras and publishedPackages when present", () => {
    const inv = parseInventoryJson({
      version: "1.0",
      lastScan: "2024-01-01",
      scanPaths: [],
      projects: [{ id: "a", path: "/a" }],
      profile: { emails: [], emailsConfirmed: false },
      insights: {},
      githubExtras: {
        starredRepos: [
          {
            name: "r",
            description: null,
            language: "TS",
            stars: 1,
            url: "https://github.com/x/r",
          },
        ],
        contributions: [{ repo: "x/y", type: "Push", date: "2024-01-01" }],
      },
      publishedPackages: [
        {
          name: "pkg",
          description: "d",
          registry: "npm" as const,
          url: "https://npm.im/pkg",
        },
      ],
    });
    expect(inv.githubExtras?.starredRepos.length).toBe(1);
    expect(inv.publishedPackages?.[0]!.name).toBe("pkg");
  });

  test("rejects invalid top-level shape", () => {
    expect(() =>
      parseInventoryJson({
        version: "1.0",
        // missing required fields
      })
    ).toThrow();
  });
});

describe("mergeInventory preserves optional GitHub fields", () => {
  test("keeps githubExtras and publishedPackages", () => {
    const existing: Inventory = {
      ...baseInventory(),
      projects: [minimalProject({ id: "keep" })],
      githubExtras: {
        starredRepos: [],
        contributions: [],
      },
      publishedPackages: [
        { name: "n", description: "", registry: "npm", url: "https://npm.im/n" },
      ],
    };
    const scanned = [minimalProject({ id: "keep", displayName: "updated" })];
    const merged = mergeInventory(existing, scanned, "/tmp");
    expect(merged.githubExtras).toEqual(existing.githubExtras);
    expect(merged.publishedPackages).toEqual(existing.publishedPackages);
  });
});
