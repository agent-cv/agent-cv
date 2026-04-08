import { describe, test, expect } from "bun:test";
import {
  parseGitRemote,
  repoStemForGrouping,
  detectProjectGroupsFromRemotes,
} from "../src/lib/discovery/remote-grouping.ts";
import type { Project } from "../src/lib/types.ts";

function baseProject(overrides: Partial<Project> = {}): Project {
  return {
    id: "id-" + Math.random().toString(36).slice(2, 8),
    path: "/tmp/p",
    displayName: "p",
    type: "node",
    language: "TS",
    frameworks: [],
    dateRange: { start: "2024-01-01", end: "2024-06-01", approximate: false },
    hasGit: true,
    commitCount: 1,
    authorCommitCount: 1,
    hasUncommittedChanges: false,
    markers: [],
    size: { files: 1, lines: 10 },
    tags: [],
    included: true,
    ...overrides,
  };
}

describe("parseGitRemote", () => {
  test("parses https github URL", () => {
    expect(parseGitRemote("https://github.com/acme/foo-api")).toEqual({
      namespace: "acme",
      repo: "foo-api",
    });
  });

  test("parses https with .git suffix", () => {
    expect(parseGitRemote("https://github.com/acme/foo-web.git")).toEqual({
      namespace: "acme",
      repo: "foo-web",
    });
  });

  test("parses ssh form", () => {
    expect(parseGitRemote("git@github.com:acme/bar.git")).toEqual({
      namespace: "acme",
      repo: "bar",
    });
  });

  test("parses gitlab nested namespace", () => {
    expect(parseGitRemote("https://gitlab.com/org/team/project")).toEqual({
      namespace: "org/team",
      repo: "project",
    });
  });

  test("returns null for empty or invalid", () => {
    expect(parseGitRemote(undefined)).toBeNull();
    expect(parseGitRemote("")).toBeNull();
    expect(parseGitRemote("not-a-url")).toBeNull();
  });
});

describe("repoStemForGrouping", () => {
  test("strips stack suffixes repeatedly", () => {
    expect(repoStemForGrouping("myapp-web")).toBe("myapp");
    expect(repoStemForGrouping("myapp-api")).toBe("myapp");
    expect(repoStemForGrouping("myapp")).toBe("myapp");
  });

  test("handles agent-cv style pair", () => {
    expect(repoStemForGrouping("agent-cv")).toBe("agent-cv");
    expect(repoStemForGrouping("agent-cv-web")).toBe("agent-cv");
  });
});

describe("detectProjectGroupsFromRemotes", () => {
  test("groups two repos in same namespace with shared stem", () => {
    const a = baseProject({
      path: "/a/foo-api",
      remoteUrl: "https://github.com/org/foo-api",
    });
    const b = baseProject({
      path: "/b/foo-web",
      remoteUrl: "https://github.com/org/foo-web",
    });
    detectProjectGroupsFromRemotes([a, b]);
    expect(a.projectGroup).toBe("foo");
    expect(b.projectGroup).toBe("foo");
  });

  test("does not group across different namespaces", () => {
    const a = baseProject({
      remoteUrl: "https://github.com/org-a/foo-web",
    });
    const b = baseProject({
      remoteUrl: "https://github.com/org-b/foo-api",
    });
    detectProjectGroupsFromRemotes([a, b]);
    expect(a.projectGroup).toBeUndefined();
    expect(b.projectGroup).toBeUndefined();
  });

  test("does not overwrite existing projectGroup", () => {
    const a = baseProject({
      projectGroup: "monorepo",
      remoteUrl: "https://github.com/org/foo-api",
    });
    const b = baseProject({
      remoteUrl: "https://github.com/org/foo-web",
    });
    detectProjectGroupsFromRemotes([a, b]);
    expect(a.projectGroup).toBe("monorepo");
    expect(b.projectGroup).toBe("foo");
  });

  test("single repo gets no group", () => {
    const a = baseProject({
      remoteUrl: "https://github.com/org/only-web",
    });
    detectProjectGroupsFromRemotes([a]);
    expect(a.projectGroup).toBeUndefined();
  });
});
