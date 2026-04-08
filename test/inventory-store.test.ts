import { describe, test, expect, beforeEach } from "bun:test";
import { readInventory, writeInventory, mergeInventory } from "@agent-cv/core/src/inventory/store.ts";
import { rm, mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import type { Project, Inventory } from "@agent-cv/core/src/types.ts";

// Use a temp directory to avoid polluting real ~/.agent-cv/
const TEST_DIR = join(import.meta.dir, "fixtures", "inventory-test");

function makeProject(overrides: Partial<Project> = {}): Project {
  return {
    id: "test-" + Math.random().toString(36).slice(2, 8),
    path: "/tmp/test-project",
    displayName: "test-project",
    type: "node",
    language: "TypeScript",
    frameworks: [],
    dateRange: { start: "2024-01-01", end: "2024-06-01", approximate: false },
    hasGit: true,
    commitCount: 10,
    authorCommitCount: 8,
    hasUncommittedChanges: false,
    lastCommit: "2024-06-01",
    markers: ["package.json", ".git"],
    size: { files: 5, lines: 500 },
    tags: [],
    included: true,
    ...overrides,
  };
}

describe("mergeInventory", () => {
  test("adds new projects", () => {
    const existing: Inventory = {
      version: "1.0",
      lastScan: "2024-01-01",
      scanPaths: ["/tmp"],
      projects: [],
      profile: { emails: [], emailsConfirmed: false },
      insights: {},
    };
    const scanned = [makeProject({ id: "new-1", displayName: "new-project" })];

    const merged = mergeInventory(existing, scanned, "/tmp");
    expect(merged.projects.length).toBe(1);
    expect(merged.projects[0]!.displayName).toBe("new-project");
  });

  test("preserves existing analysis on merge", () => {
    const analysis = {
      summary: "A great project",
      techStack: ["TypeScript"],
      contributions: ["Built stuff"],
      analyzedAt: "2024-01-01",
      analyzedBy: "claude",
    };
    const existing: Inventory = {
      version: "1.0",
      lastScan: "2024-01-01",
      scanPaths: ["/tmp"],
      projects: [makeProject({ id: "p1", analysis })],
      profile: { emails: [], emailsConfirmed: false },
      insights: {},
    };
    const scanned = [makeProject({ id: "p1" })];

    const merged = mergeInventory(existing, scanned, "/tmp");
    expect(merged.projects[0]!.analysis).toEqual(analysis);
  });

  test("marks removed projects", () => {
    const existing: Inventory = {
      version: "1.0",
      lastScan: "2024-01-01",
      scanPaths: ["/tmp"],
      projects: [makeProject({ id: "old", path: "/tmp/old-project" })],
      profile: { emails: [], emailsConfirmed: false },
      insights: {},
    };

    const merged = mergeInventory(existing, [], "/tmp");
    expect(merged.projects[0]!.tags).toContain("removed");
  });

  test("preserves user tags", () => {
    const existing: Inventory = {
      version: "1.0",
      lastScan: "2024-01-01",
      scanPaths: ["/tmp"],
      projects: [makeProject({ id: "p1", tags: ["forgotten-gem"] })],
      profile: { emails: [], emailsConfirmed: false },
      insights: {},
    };
    const scanned = [makeProject({ id: "p1" })];

    const merged = mergeInventory(existing, scanned, "/tmp");
    expect(merged.projects[0]!.tags).toContain("forgotten-gem");
  });

  test("updates scan paths", () => {
    const existing: Inventory = {
      version: "1.0",
      lastScan: "2024-01-01",
      scanPaths: ["/old-path"],
      projects: [],
      profile: { emails: [], emailsConfirmed: false },
      insights: {},
    };

    const merged = mergeInventory(existing, [], "/new-path");
    expect(merged.scanPaths).toContain("/old-path");
    expect(merged.scanPaths).toContain("/new-path");
  });
});
