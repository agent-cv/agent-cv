import { describe, test, expect } from "bun:test";
import { detectForgottenGems } from "@agent-cv/core/src/discovery/forgotten-gems.ts";
import type { Project } from "@agent-cv/core/src/types.ts";

function makeProject(overrides: Partial<Project> = {}): Project {
  return {
    id: "test-" + Math.random().toString(36).slice(2, 8),
    path: "/tmp/test",
    displayName: "test",
    type: "node",
    language: "TypeScript",
    frameworks: [],
    dateRange: { start: "2023-01-01", end: "2023-06-01", approximate: false },
    hasGit: true,
    commitCount: 30,
    authorCommitCount: 25,
    hasUncommittedChanges: false,
    lastCommit: "2023-06-01",
    markers: ["package.json"],
    size: { files: 10, lines: 1000 },
    tags: [],
    included: true,
    ...overrides,
  };
}

describe("detectForgottenGems", () => {
  test("flags old project with many commits and no analysis", () => {
    const gems = detectForgottenGems([
      makeProject({ commitCount: 30, authorCommitCount: 25, lastCommit: "2023-01-01" }),
    ]);
    expect(gems.length).toBe(1);
  });

  test("does not flag recently active project", () => {
    const gems = detectForgottenGems([
      makeProject({ commitCount: 30, lastCommit: new Date().toISOString().split("T")[0] }),
    ]);
    expect(gems.length).toBe(0);
  });

  test("does not flag project with existing analysis", () => {
    const gems = detectForgottenGems([
      makeProject({
        commitCount: 30,
        lastCommit: "2023-01-01",
        analysis: {
          summary: "Already analyzed",
          techStack: ["TS"],
          contributions: [],
          analyzedAt: "2024-01-01",
          analyzedBy: "claude",
        },
      }),
    ]);
    expect(gems.length).toBe(0);
  });

  test("does not flag project with few commits", () => {
    const gems = detectForgottenGems([
      makeProject({ commitCount: 5, authorCommitCount: 3, lastCommit: "2023-01-01" }),
    ]);
    expect(gems.length).toBe(0);
  });

  test("does not flag foreign projects (0 author commits)", () => {
    const gems = detectForgottenGems([
      makeProject({ commitCount: 100, authorCommitCount: 0, lastCommit: "2023-01-01" }),
    ]);
    expect(gems.length).toBe(0);
  });

  test("does not flag removed projects", () => {
    const gems = detectForgottenGems([
      makeProject({ commitCount: 30, lastCommit: "2023-01-01", tags: ["removed"] }),
    ]);
    expect(gems.length).toBe(0);
  });
});
